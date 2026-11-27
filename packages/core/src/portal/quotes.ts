import { z } from "zod";
import { clientParty } from "../audit";
import { findEditableCustomerNarrow, lockCustomer } from "../customers/store";
import {
  QuoteExpiredError,
  QuoteNotIssuedError,
  acceptCore,
  declineCore,
} from "../quotes/acceptance";
import {
  PUBLIC_QUOTE_SELECT,
  buildPublicView,
  type LinkAcceptInput,
  type LinkDeclineInput,
  type PublicQuoteView,
} from "../quotes/public";
import { todaySA } from "../quotes/reference";
import { loadPortalScope, pickActingContact, type PortalScope } from "./scope";
import type { PortalStore } from "./store";

/** Quotes a client may see in the portal: issued (open or expired), accepted, declined. */
export const PORTAL_VISIBLE_STATUSES = ["ISSUED", "ACCEPTED", "DECLINED"] as const;

const isUuid = (value: string) => z.uuid().safeParse(value).success;

export type PortalQuoteView = PublicQuoteView & { id: string };

/** One quote, if its customer is in the scope and it is visible. Anything else is null (shown as not found). */
export async function getPortalQuote(
  store: PortalStore,
  scope: PortalScope,
  quoteId: string,
  now: Date = new Date(),
): Promise<PortalQuoteView | null> {
  if (!isUuid(quoteId)) return null;
  const q = await store.quote.findFirst({
    where: {
      id: quoteId,
      customerId: { in: [...scope.customerIds] },
      status: { in: [...PORTAL_VISIBLE_STATUSES] },
    },
    select: PUBLIC_QUOTE_SELECT,
  });
  if (!q) return null;
  const view = buildPublicView(q, todaySA(now));
  return view ? { id: q.id, ...view } : null;
}

/** The quote (restricted to the scope inside the query) and who would act on it. */
async function findActable(store: PortalStore, scope: PortalScope, quoteId: string) {
  if (!isUuid(quoteId)) return null;
  const quote = await store.quote.findFirst({
    where: {
      id: quoteId,
      customerId: { in: [...scope.customerIds] },
      status: { in: [...PORTAL_VISIBLE_STATUSES] },
    },
    select: {
      id: true,
      customerId: true,
      status: true,
      customer: { select: { id: true, managedById: true } },
    },
  });
  if (!quote) return null;
  const acting = pickActingContact(scope, quote.customer);
  return acting ? { quote, acting } : null;
}

/**
 * Locks the quote's customer (customer before quote, as everywhere), then recomputes the scope from live
 * data and finds the quote again: a complex moved to another agency, or access removed, after the request
 * started is refused here. Linking and access changes take the same customer lock.
 */
async function findActableUnderLock(
  store: PortalStore,
  scope: PortalScope,
  quoteId: string,
  customerId: string,
) {
  await findEditableCustomerNarrow(store, customerId);
  await lockCustomer(store, customerId);
  const fresh = await loadPortalScope(store, scope.email);
  return fresh ? findActable(store, fresh, quoteId) : null;
}

export type PortalAcceptResult =
  | { outcome: "ACCEPTED"; customerFlag: "PAUSED" | "ARCHIVED" | null; quoteId: string }
  | { outcome: "ALREADY_ACCEPTED" }
  | { outcome: "EXPIRED" }
  | { outcome: "NOT_AVAILABLE" }
  | { outcome: "NOT_FOUND" };

/**
 * The signed-in client accepts an open quote: the shared acceptance routine with method CLIENT_PORTAL, the
 * acting contact's id, and the same proof as the link. Call inside a transaction. Plain DomainErrors (a past
 * start date, a line that is not an add-on) propagate.
 */
export async function acceptPortalQuote(
  store: PortalStore,
  scope: PortalScope,
  quoteId: string,
  input: LinkAcceptInput,
  ctx: { ip: string | null; userAgent: string | null },
): Promise<PortalAcceptResult> {
  const found = await findActable(store, scope, quoteId);
  if (!found) return { outcome: "NOT_FOUND" };
  if (found.quote.status === "ACCEPTED") return { outcome: "ALREADY_ACCEPTED" };
  if (found.quote.status !== "ISSUED") return { outcome: "NOT_AVAILABLE" };
  try {
    const again = await findActableUnderLock(store, scope, quoteId, found.quote.customerId);
    if (!again) return { outcome: "NOT_FOUND" };
    const { customerFlag } = await acceptCore(
      store,
      {
        audit: clientParty(again.acting.customerId),
        method: "CLIENT_PORTAL",
        staffId: null,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        acceptedByContactId: again.acting.contactId,
      },
      quoteId,
      input,
    );
    return { outcome: "ACCEPTED", customerFlag, quoteId };
  } catch (error) {
    if (error instanceof QuoteExpiredError) return { outcome: "EXPIRED" };
    if (error instanceof QuoteNotIssuedError) {
      return error.status === "ACCEPTED"
        ? { outcome: "ALREADY_ACCEPTED" }
        : { outcome: "NOT_AVAILABLE" };
    }
    throw error;
  }
}

export type PortalDeclineResult =
  | { outcome: "DECLINED" }
  | { outcome: "ALREADY_DECLINED" }
  | { outcome: "NOT_AVAILABLE" }
  | { outcome: "NOT_FOUND" };

/** The signed-in client declines an issued quote. Call inside a transaction. */
export async function declinePortalQuote(
  store: PortalStore,
  scope: PortalScope,
  quoteId: string,
  input: LinkDeclineInput,
): Promise<PortalDeclineResult> {
  const found = await findActable(store, scope, quoteId);
  if (!found) return { outcome: "NOT_FOUND" };
  if (found.quote.status === "DECLINED") return { outcome: "ALREADY_DECLINED" };
  if (found.quote.status !== "ISSUED") return { outcome: "NOT_AVAILABLE" };
  try {
    const again = await findActableUnderLock(store, scope, quoteId, found.quote.customerId);
    if (!again) return { outcome: "NOT_FOUND" };
    await declineCore(
      store,
      { audit: clientParty(again.acting.customerId), declinedByClient: true, via: "portal" },
      quoteId,
      input,
    );
    return { outcome: "DECLINED" };
  } catch (error) {
    if (error instanceof QuoteNotIssuedError) {
      return error.status === "DECLINED"
        ? { outcome: "ALREADY_DECLINED" }
        : { outcome: "NOT_AVAILABLE" };
    }
    throw error;
  }
}
