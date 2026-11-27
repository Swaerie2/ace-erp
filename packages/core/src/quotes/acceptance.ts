import type { AuditParty } from "../audit";
import { DomainError } from "../customers/access";
import { activateCustomerInternal } from "../customers/customers";
import { findEditableCustomerNarrow, lockCustomer } from "../customers/store";
import type { Db } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { displayStatus, fromDateString, todaySA } from "./reference";
import { logQuoteEventAs, lockQuote } from "./store";

/** What the acceptance routines need. A subset of every store that may call them (staff or portal). */
export type AcceptStore = Pick<Db, "quote" | "quoteLine" | "customer" | "property" | "auditLog">;

/** The quote is not in the state this action needs. `status` is the status found. */
export class QuoteNotIssuedError extends DomainError {
  readonly status: string;
  constructor(status: string, message: string) {
    super(message);
    this.name = "QuoteNotIssuedError";
    this.status = status;
  }
}

export class QuoteExpiredError extends DomainError {
  constructor() {
    super("This quote has expired. Revise it to give it new dates.");
    this.name = "QuoteExpiredError";
  }
}

/**
 * The quote was found by a client link code that is no longer its current one (the link was revoked or
 * replaced after the request found the quote). The client sees "not found".
 */
export class LinkNoLongerValidError extends DomainError {
  constructor() {
    super("That link is no longer valid.");
    this.name = "LinkNoLongerValidError";
  }
}

export type AcceptContext = {
  audit: AuditParty;
  method:
    "WHATSAPP" | "EMAIL" | "PHONE" | "IN_PERSON" | "SIGNED_COPY" | "CLIENT_LINK" | "CLIENT_PORTAL";
  /** The staff member who recorded it; null when the client accepted on the link. */
  staffId: string | null;
  ip: string | null;
  userAgent: string | null;
  /**
   * Set by the client link: the code the quote was found by. If the quote's current code is different
   * when the quote is read again under the locks, nothing is done. Staff callers leave it out.
   */
  expectLinkToken?: string | undefined;
  /** Set by the client portal: the signed-in contact who accepted. Staff and the link leave it out. */
  acceptedByContactId?: string | null | undefined;
};

/** A monthly agreement means a priced monthly line, or an optional monthly line the client chose. */
const MONTHLY_AGREEMENT: Prisma.QuoteLineWhereInput = {
  billing: "MONTHLY",
  OR: [{ lineKind: "PRICED" }, { lineKind: "OPTIONAL", chosen: true }],
};

const ACCEPT_SELECT = {
  id: true,
  customerId: true,
  propertyId: true,
  status: true,
  validUntil: true,
  linkToken: true,
  lines: { select: { id: true, lineKind: true, billing: true } },
} as const satisfies Prisma.QuoteSelect;

/** A revoked or replaced link stops working at once, even for a request that had already found the quote. */
function assertLinkStillCurrent(currentToken: string | null, expected: string | undefined) {
  if (expected !== undefined && currentToken !== expected) throw new LinkNoLongerValidError();
}

async function readForAccept(store: AcceptStore, id: string) {
  const quote = await store.quote.findUnique({ where: { id }, select: ACCEPT_SELECT });
  if (!quote) throw new DomainError("That quote could not be found.");
  return quote;
}

/**
 * The acceptance rules, shared by staff (recording an acceptance) and the client link. Every read names
 * its columns. Lock order: customer, then property, then quote. The caller must run it inside a
 * transaction and do any role or token check first.
 */
export async function acceptCore(
  store: AcceptStore,
  ctx: AcceptContext,
  quoteId: string,
  input: {
    acceptedBy: string;
    startDate: string;
    chosenLineIds: string[];
    note?: string | undefined;
  },
): Promise<{ customerFlag: "PAUSED" | "ARCHIVED" | null }> {
  const check = (q: Awaited<ReturnType<typeof readForAccept>>) => {
    assertLinkStillCurrent(q.linkToken, ctx.expectLinkToken);
    if (q.status !== "ISSUED") {
      throw new QuoteNotIssuedError(q.status, "Only an issued quote can be accepted.");
    }
    if (displayStatus(q) === "EXPIRED") throw new QuoteExpiredError();
  };
  // Look first, without any lock, so a refused request takes no lock at all.
  const first = await readForAccept(store, quoteId);
  check(first);
  if (input.startDate < todaySA()) throw new DomainError("The start date must be today or later.");
  // The customer lock (refused for an anonymised customer) stops personal text being written back onto
  // one; the property lock makes accepts and reversals for one property take turns.
  await findEditableCustomerNarrow(store, first.customerId);
  await lockCustomer(store, first.customerId);
  await store.property.updateMany({
    where: { id: first.propertyId },
    data: { updatedAt: new Date() },
  });
  await lockQuote(store, quoteId);
  const quote = await readForAccept(store, quoteId);
  check(quote);
  const chosenIds = [...new Set(input.chosenLineIds)];
  const optionalIds = new Set(
    quote.lines.filter((l) => l.lineKind === "OPTIONAL").map((l) => l.id),
  );
  if (chosenIds.some((lineId) => !optionalIds.has(lineId))) {
    throw new DomainError("Only optional add-ons can be chosen.");
  }

  await store.quoteLine.updateMany({
    where: { quoteId, id: { in: chosenIds } },
    data: { chosen: true },
  });
  await store.quote.update({
    where: { id: quoteId },
    data: {
      status: "ACCEPTED",
      acceptedAt: new Date(),
      acceptedMethod: ctx.method,
      acceptedByName: input.acceptedBy,
      acceptedStartDate: fromDateString(input.startDate),
      acceptanceNote: input.note ?? null,
      acceptedByStaffId: ctx.staffId,
      acceptedIp: ctx.ip,
      acceptedUserAgent: ctx.userAgent,
      acceptedByContactId: ctx.acceptedByContactId ?? null,
      // A freshly accepted quote starts as a live agreement.
      agreementEndedAt: null,
      agreementReplacedById: null,
    },
    select: { id: true },
  });

  // Agreement rule: a newly accepted monthly quote replaces the property's earlier monthly agreement.
  const isMonthly = quote.lines.some(
    (l) =>
      l.billing === "MONTHLY" &&
      (l.lineKind === "PRICED" || (l.lineKind === "OPTIONAL" && chosenIds.includes(l.id))),
  );
  if (isMonthly) {
    const earlier = await store.quote.findMany({
      where: {
        propertyId: quote.propertyId,
        status: "ACCEPTED",
        agreementEndedAt: null,
        id: { not: quoteId },
        lines: { some: MONTHLY_AGREEMENT },
      },
      select: { id: true },
    });
    for (const old of earlier) {
      // Conditional, so a quote that changed state in the meantime is never marked as replaced.
      const { count } = await store.quote.updateMany({
        where: { id: old.id, status: "ACCEPTED", agreementEndedAt: null },
        data: { agreementEndedAt: new Date(), agreementReplacedById: quoteId },
      });
      if (count === 1) {
        await logQuoteEventAs(store, ctx.audit, "quote.agreement_ended", old.id, {
          replacedBy: quoteId,
        });
      }
    }
  }

  // A lead becomes active. A paused or archived customer is left alone and flagged.
  const customer = await store.customer.findUniqueOrThrow({
    where: { id: quote.customerId },
    select: { status: true },
  });
  let customerFlag: "PAUSED" | "ARCHIVED" | null = null;
  if (customer.status === "LEAD") {
    await activateCustomerInternal(store, ctx.audit, quote.customerId, { via: "quote" });
  } else if (customer.status === "PAUSED" || customer.status === "ARCHIVED") {
    customerFlag = customer.status;
  }

  await logQuoteEventAs(store, ctx.audit, "quote.accepted", quoteId, {
    method: ctx.method,
    optionsChosen: chosenIds.length,
    customerFlag,
  });
  return { customerFlag };
}

/** Declining: ISSUED only. Lock order customer, then quote. */
export async function declineCore(
  store: AcceptStore,
  ctx: {
    audit: AuditParty;
    declinedByClient: boolean;
    expectLinkToken?: string | undefined;
    via?: "portal" | undefined;
  },
  quoteId: string,
  input: { reason?: string | undefined },
): Promise<void> {
  const read = async () => {
    const quote = await store.quote.findUnique({
      where: { id: quoteId },
      select: { id: true, customerId: true, status: true, linkToken: true },
    });
    if (!quote) throw new DomainError("That quote could not be found.");
    assertLinkStillCurrent(quote.linkToken, ctx.expectLinkToken);
    if (quote.status !== "ISSUED") {
      throw new QuoteNotIssuedError(quote.status, "Only an issued quote can be declined.");
    }
    return quote;
  };
  const first = await read();
  await findEditableCustomerNarrow(store, first.customerId);
  await lockCustomer(store, first.customerId);
  await lockQuote(store, quoteId);
  await read();
  await store.quote.update({
    where: { id: quoteId },
    data: {
      status: "DECLINED",
      declinedAt: new Date(),
      declineReason: input.reason ?? null,
      declinedByClient: ctx.declinedByClient,
    },
    select: { id: true },
  });
  await logQuoteEventAs(
    store,
    ctx.audit,
    "quote.declined",
    quoteId,
    ctx.via ? { via: ctx.via } : undefined,
  );
}
