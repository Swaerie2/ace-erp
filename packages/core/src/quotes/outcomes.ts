import { staffParty } from "../audit";
import { assertRole, DomainError, MANAGEMENT, OWNER_ONLY, type Actor } from "../customers/access";
import { findEditableCustomer, lockCustomer } from "../customers/store";
import type { Prisma } from "../generated/prisma/client";
import { formatQuoteReference } from "./reference";
import type { AcceptInput, DeclineInput } from "./schemas";
import { acceptCore, declineCore } from "./acceptance";
import { findQuote, lockQuote, logQuoteEvent, type QuoteStore } from "./store";
import { acceptedTotals } from "./totals";

/** A monthly agreement means a priced monthly line, or an optional monthly line the client chose. */
const MONTHLY_AGREEMENT: Prisma.QuoteLineWhereInput = {
  billing: "MONTHLY",
  OR: [{ lineKind: "PRICED" }, { lineKind: "OPTIONAL", chosen: true }],
};
const ONCE_OFF_AGREEMENT: Prisma.QuoteLineWhereInput = {
  billing: "ONCE_OFF",
  OR: [{ lineKind: "PRICED" }, { lineKind: "OPTIONAL", chosen: true }],
};

export async function acceptQuote(
  store: QuoteStore,
  actor: Actor,
  id: string,
  input: AcceptInput,
): Promise<{ customerFlag: "PAUSED" | "ARCHIVED" | null }> {
  assertRole(actor, MANAGEMENT);
  return acceptCore(
    store,
    {
      audit: staffParty(actor),
      method: input.method,
      staffId: actor.id,
      ip: null,
      userAgent: null,
    },
    id,
    {
      acceptedBy: input.acceptedBy,
      startDate: input.startDate,
      chosenLineIds: input.chosenLineIds,
      note: input.note,
    },
  );
}

export async function declineQuote(
  store: QuoteStore,
  actor: Actor,
  id: string,
  input: DeclineInput,
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  await declineCore(store, { audit: staffParty(actor), declinedByClient: false }, id, {
    reason: input.reason,
  });
}

/** Owner only. Puts an accepted quote back to issued; the customer's status is not touched. */
export async function reverseAcceptance(
  store: QuoteStore,
  actor: Actor,
  id: string,
  note: string,
): Promise<void> {
  assertRole(actor, OWNER_ONLY);
  const text = note.trim();
  if (!text) throw new DomainError("Say why the acceptance is being reversed.");
  if (text.length > 300) throw new DomainError("Keep the reason to 300 characters or fewer.");
  const check = (q: Awaited<ReturnType<typeof findQuote>>) => {
    if (q.status !== "ACCEPTED") throw new DomainError("Only an accepted quote can be reversed.");
    if (q.agreementEndedAt) {
      throw new DomainError("A later quote has replaced this agreement. Reverse that one first.");
    }
  };
  const first = await findQuote(store, id);
  check(first);
  await findEditableCustomer(store, first.customerId);
  await lockCustomer(store, first.customerId);
  await store.property.updateMany({
    where: { id: first.propertyId },
    data: { updatedAt: new Date() },
  });
  await lockQuote(store, id);
  check(await findQuote(store, id));

  await store.quoteLine.updateMany({ where: { quoteId: id }, data: { chosen: false } });
  await store.quote.update({
    where: { id },
    data: {
      status: "ISSUED",
      acceptedAt: null,
      acceptedMethod: null,
      acceptedByName: null,
      acceptedStartDate: null,
      acceptanceNote: null,
      acceptedByStaffId: null,
      acceptedIp: null,
      acceptedUserAgent: null,
      acceptedByContactId: null,
      reversedAt: new Date(),
      reversalNote: text,
    },
  });
  // Any agreement this quote had ended is restored.
  await store.quote.updateMany({
    where: { agreementReplacedById: id },
    data: { agreementEndedAt: null, agreementReplacedById: null },
  });
  await logQuoteEvent(store, actor, "quote.reversed", id);
}

const AGREEMENT_SELECT = {
  id: true,
  numberYear: true,
  numberSeq: true,
  revision: true,
  acceptedAt: true,
  acceptedStartDate: true,
  scopeItems: {
    where: { included: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, description: true, kind: true },
  },
  lines: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      lineKind: true,
      billing: true,
      frequency: true,
      description: true,
      amountCents: true,
      chosen: true,
    },
  },
} as const satisfies Prisma.QuoteSelect;

type AgreementRow = Prisma.QuoteGetPayload<{ select: typeof AGREEMENT_SELECT }>;

function toAgreement(row: AgreementRow) {
  return {
    id: row.id,
    reference: formatQuoteReference(row),
    acceptedAt: row.acceptedAt,
    acceptedStartDate: row.acceptedStartDate,
    scope: row.scopeItems,
    lines: row.lines.filter((l) => l.lineKind !== "OPTIONAL" || l.chosen),
    totals: acceptedTotals(row.lines),
  };
}

/**
 * The property's agreed scope: its current monthly agreement and its accepted once-off quotes. A
 * quote with both monthly and once-off work is the monthly agreement and is not listed twice; a
 * monthly agreement that a later one replaced is no longer shown.
 */
export async function getPropertyAgreement(store: QuoteStore, actor: Actor, propertyId: string) {
  assertRole(actor, MANAGEMENT);
  const current = await store.quote.findFirst({
    where: {
      propertyId,
      status: "ACCEPTED",
      agreementEndedAt: null,
      lines: { some: MONTHLY_AGREEMENT },
    },
    orderBy: [{ acceptedAt: "desc" }, { id: "desc" }],
    select: AGREEMENT_SELECT,
  });
  const onceOff = await store.quote.findMany({
    where: {
      propertyId,
      status: "ACCEPTED",
      agreementEndedAt: null,
      lines: { some: ONCE_OFF_AGREEMENT },
      ...(current ? { id: { not: current.id } } : {}),
    },
    orderBy: [{ acceptedAt: "desc" }, { id: "desc" }],
    select: AGREEMENT_SELECT,
  });
  return { current: current ? toAgreement(current) : null, onceOff: onceOff.map(toAgreement) };
}
