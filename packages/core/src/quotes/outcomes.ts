import { assertRole, DomainError, MANAGEMENT, OWNER_ONLY, type Actor } from "../customers/access";
import { activateCustomer } from "../customers/customers";
import type { Prisma } from "../generated/prisma/client";
import { displayStatus, formatQuoteReference, fromDateString, todaySA } from "./reference";
import type { AcceptInput, DeclineInput } from "./schemas";
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
  const check = (q: Awaited<ReturnType<typeof findQuote>>) => {
    if (q.status !== "ISSUED") throw new DomainError("Only an issued quote can be accepted.");
    if (displayStatus(q) === "EXPIRED") {
      throw new DomainError("This quote has expired. Revise it to give it new dates.");
    }
  };
  check(await findQuote(store, id));
  await lockQuote(store, id);
  const quote = await findQuote(store, id);
  check(quote);
  if (input.startDate < todaySA()) throw new DomainError("The start date must be today or later.");
  const optionalIds = new Set(
    quote.lines.filter((l) => l.lineKind === "OPTIONAL").map((l) => l.id),
  );
  if (input.chosenLineIds.some((lineId) => !optionalIds.has(lineId))) {
    throw new DomainError("Only optional add-ons can be chosen.");
  }

  await store.quoteLine.updateMany({
    where: { quoteId: id, id: { in: input.chosenLineIds } },
    data: { chosen: true },
  });
  await store.quote.update({
    where: { id },
    data: {
      status: "ACCEPTED",
      acceptedAt: new Date(),
      acceptedMethod: input.method,
      acceptedByName: input.acceptedBy,
      acceptedStartDate: fromDateString(input.startDate),
      acceptanceNote: input.note ?? null,
      acceptedByStaffId: actor.id,
    },
  });

  // Agreement rule: a newly accepted monthly quote replaces the property's earlier monthly agreement.
  const isMonthly = quote.lines.some(
    (l) =>
      l.billing === "MONTHLY" &&
      (l.lineKind === "PRICED" ||
        (l.lineKind === "OPTIONAL" && input.chosenLineIds.includes(l.id))),
  );
  if (isMonthly) {
    const earlier = await store.quote.findMany({
      where: {
        propertyId: quote.propertyId,
        status: "ACCEPTED",
        agreementEndedAt: null,
        id: { not: id },
        lines: { some: MONTHLY_AGREEMENT },
      },
      select: { id: true },
    });
    for (const old of earlier) {
      await store.quote.update({
        where: { id: old.id },
        data: { agreementEndedAt: new Date(), agreementReplacedById: id },
      });
      await logQuoteEvent(store, actor, "quote.agreement_ended", old.id, { replacedBy: id });
    }
  }

  // A lead becomes active. A paused or archived customer is left alone and flagged to staff.
  const customer = await store.customer.findUniqueOrThrow({
    where: { id: quote.customerId },
    select: { status: true },
  });
  let customerFlag: "PAUSED" | "ARCHIVED" | null = null;
  if (customer.status === "LEAD") {
    await activateCustomer(store, actor, quote.customerId, { via: "quote" });
  } else if (customer.status === "PAUSED" || customer.status === "ARCHIVED") {
    customerFlag = customer.status;
  }

  await logQuoteEvent(store, actor, "quote.accepted", id, {
    method: input.method,
    optionsChosen: input.chosenLineIds.length,
    customerFlag,
  });
  return { customerFlag };
}

export async function declineQuote(
  store: QuoteStore,
  actor: Actor,
  id: string,
  input: DeclineInput,
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  if ((await findQuote(store, id)).status !== "ISSUED") {
    throw new DomainError("Only an issued quote can be declined.");
  }
  await lockQuote(store, id);
  if ((await findQuote(store, id)).status !== "ISSUED") {
    throw new DomainError("Only an issued quote can be declined.");
  }
  await store.quote.update({
    where: { id },
    data: { status: "DECLINED", declinedAt: new Date(), declineReason: input.reason ?? null },
  });
  await logQuoteEvent(store, actor, "quote.declined", id);
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
  if (text.length > 300) throw new DomainError("Keep the reason under 300 characters.");
  const check = (q: Awaited<ReturnType<typeof findQuote>>) => {
    if (q.status !== "ACCEPTED") throw new DomainError("Only an accepted quote can be reversed.");
    if (q.agreementEndedAt) {
      throw new DomainError("A later quote has replaced this agreement. Reverse that one first.");
    }
  };
  check(await findQuote(store, id));
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
