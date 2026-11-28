import { z } from "zod";
import {
  assertRole,
  DomainError,
  ForbiddenError,
  MANAGEMENT,
  type Actor,
} from "../customers/access";
import { lockCustomer } from "../customers/store";
import type { Prisma } from "../generated/prisma/client";
import type { TxRunner } from "../portal/access";
import { fromDateString, toDateString, todaySA } from "../quotes/reference";
import {
  dueDateFor,
  firstDayOf,
  formatDayMonth,
  lastDayOf,
  proRata,
  runMonthAllowed,
  serviceMonthFor,
} from "./dates";
import type { RunSkipReason } from "./labels";
import { fitDescription } from "./money";
import { formatInvoiceReference } from "./reference";
import { readInvoiceSettings } from "./settings";
import {
  allocatedByInvoice,
  billToIdFor,
  INVOICE_MESSAGES,
  isMonthlyDuplicate,
  logInvoiceEvent,
  type InvoiceStore,
} from "./store";

/** A monthly agreement line: priced monthly, or an optional monthly line the client chose. */
export const MONTHLY_AGREEMENT: Prisma.QuoteLineWhereInput = {
  billing: "MONTHLY",
  OR: [{ lineKind: "PRICED" }, { lineKind: "OPTIONAL", chosen: true }],
};

/** The same rule as `MONTHLY_AGREEMENT`, for lines already read (keep the two in step). */
export function isMonthlyAgreementLine(line: {
  billing: string | null;
  lineKind: string;
  chosen: boolean;
}): boolean {
  return (
    line.billing === "MONTHLY" &&
    (line.lineKind === "PRICED" || (line.lineKind === "OPTIONAL" && line.chosen))
  );
}

/**
 * The monthly agreements the run may bill, on a property still in use: the current ones (the same notion as
 * `getPropertyAgreement`) AND the ones a later accepted quote replaced (accepting a replacement ends the old
 * agreement at once, but the owner's rule is "old price until the new start month"). An agreement ended any
 * other way (`agreementEndedAt` set without `agreementReplacedById`) is never used. Reversing a replacement
 * clears both columns on the old quote, so it is current again.
 */
export const BILLABLE_AGREEMENT = {
  status: "ACCEPTED",
  OR: [{ agreementEndedAt: null }, { agreementReplacedById: { not: null } }],
  property: { archivedAt: null },
  lines: { some: MONTHLY_AGREEMENT },
} satisfies Prisma.QuoteWhereInput;

/** Ids from the app are checked before they reach a uuid column (a bad one would make Postgres refuse). */
const isUuid = (value: string) => z.uuid().safeParse(value).success;

export type RunResult = {
  runMonth: string;
  created: { invoiceId: string; customerId: string }[];
  skipped: { customerId: string; displayName: string; reason: RunSkipReason }[];
};

type Skipped = { reason: RunSkipReason };
type Outcome = { invoiceId: string } | Skipped;
const skipped = (reason: RunSkipReason): Skipped => ({ reason });

type Context = { actor: Actor; runMonth: string; today: string; lateFeeCents: number };

/** The start of an agreement: its accepted start date, else its acceptance date; null means never started. */
function startOf(q: { acceptedStartDate: Date | null; acceptedAt: Date | null }): string | null {
  if (q.acceptedStartDate) return toDateString(q.acceptedStartDate);
  return q.acceptedAt ? todaySA(q.acceptedAt) : null;
}

/** Later start first; on the same start the later acceptance (then the larger id) wins. */
function laterFirst(
  a: { start: string; acceptedAt: Date | null; id: string },
  b: { start: string; acceptedAt: Date | null; id: string },
): number {
  if (a.start !== b.start) return a.start > b.start ? -1 : 1;
  const at = (a.acceptedAt?.getTime() ?? 0) - (b.acceptedAt?.getTime() ?? 0);
  if (at !== 0) return -at;
  return a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
}

/**
 * The agreement IN FORCE on each of the customer's properties for the service month, sorted by property label
 * (then id). In force: of the property's billable agreements, the one with the latest start on or before the last
 * day of the service month. A replaced agreement counts only while it started before its replacement (one
 * replaced before it ever started is superseded altogether). `partMonth` is true only when the property has no
 * earlier-starting agreement at all: a brand new agreement may be pro-rated, a replacement is billed for the
 * whole month at its own price.
 */
export async function loadAgreements(tx: InvoiceStore, customerId: string, serviceMonth: string) {
  const quotes = await tx.quote.findMany({
    where: { customerId, ...BILLABLE_AGREEMENT },
    select: {
      id: true,
      propertyId: true,
      acceptedAt: true,
      acceptedStartDate: true,
      agreementEndedAt: true,
      agreementReplacedById: true,
      property: { select: { label: true } },
      lines: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          lineKind: true,
          billing: true,
          description: true,
          amountCents: true,
          chosen: true,
        },
      },
    },
  });
  const started = quotes.flatMap((q) => {
    const start = startOf(q);
    return start ? [{ ...q, start }] : [];
  });
  const startById = new Map(started.map((q) => [q.id, q.start]));
  const usable = started.filter((q) => {
    if (q.agreementEndedAt === null) return true;
    const replacerStart = q.agreementReplacedById
      ? startById.get(q.agreementReplacedById)
      : undefined;
    return replacerStart !== undefined && q.start < replacerStart;
  });
  const monthEnd = lastDayOf(serviceMonth);
  const byProperty = new Map<string, typeof usable>();
  for (const q of usable)
    byProperty.set(q.propertyId, [...(byProperty.get(q.propertyId) ?? []), q]);
  const inForce = [...byProperty.values()].flatMap((list) => {
    const current = list.filter((q) => q.start <= monthEnd).sort(laterFirst)[0];
    if (!current) return [];
    const partMonth = !list.some((q) => q.id !== current.id && q.start < current.start);
    return [{ ...current, partMonth }];
  });
  return inForce.sort((a, b) =>
    a.property.label !== b.property.label
      ? a.property.label < b.property.label
        ? -1
        : 1
      : a.propertyId < b.propertyId
        ? -1
        : 1,
  );
}

/** The suggested late-fee lines: one per overdue issued invoice that has no live fee charged against it yet. */
async function lateFeeLines(tx: InvoiceStore, customerId: string, ctx: Context) {
  if (ctx.lateFeeCents <= 0) return [];
  const candidates = await tx.invoice.findMany({
    where: { customerId, status: "ISSUED", dueDate: { lt: fromDateString(ctx.today) } },
    orderBy: [{ numberYear: "asc" }, { numberSeq: "asc" }],
    select: { id: true, numberYear: true, numberSeq: true, totalCents: true },
  });
  if (candidates.length === 0) return [];
  const ids = candidates.map((c) => c.id);
  const allocated = await allocatedByInvoice(tx, ids);
  const charged = new Set(
    (
      await tx.invoiceLine.findMany({
        where: {
          kind: "LATE_FEE",
          forInvoiceId: { in: ids },
          invoice: { status: { not: "VOID" } },
        },
        select: { forInvoiceId: true },
      })
    ).flatMap((l) => (l.forInvoiceId ? [l.forInvoiceId] : [])),
  );
  return candidates
    .filter((c) => (c.totalCents ?? 0) - (allocated.get(c.id) ?? 0) > 0 && !charged.has(c.id))
    .map((c) => ({
      kind: "LATE_FEE" as const,
      description: fitDescription(`Late payment fee: ${formatInvoiceReference(c) ?? ""}`),
      amountCents: ctx.lateFeeCents,
      forInvoiceId: c.id,
    }));
}

/**
 * The service lines of the agreements in force, in order: properties by label, then each agreement's monthly
 * lines in quote order (lines of zero left out). Only a brand new agreement starting after the 1st of the service
 * month is pro-rated; a replacement is billed for the whole month.
 */
export function serviceLinesFor(
  agreements: Awaited<ReturnType<typeof loadAgreements>>,
  serviceMonth: string,
) {
  return agreements.flatMap((a) =>
    a.lines
      .filter((l) => isMonthlyAgreementLine(l) && (l.amountCents ?? 0) > 0)
      .map((l) => {
        const amount = l.amountCents ?? 0;
        const base = `${a.property.label}: ${l.description}`;
        const part = a.partMonth ? proRata(amount, a.start, serviceMonth) : null;
        return {
          kind: l.lineKind === "PRICED" ? ("SERVICE" as const) : ("OPTIONAL" as const),
          description: fitDescription(
            part
              ? `${base} (part month: ${part.days} of ${part.daysInMonth} days from ${formatDayMonth(a.start)})`
              : base,
          ),
          amountCents: part ? part.amountCents : amount,
          propertyId: a.propertyId,
          sourceQuoteLineId: l.id,
        };
      }),
  );
}

/**
 * One customer, inside its own transaction. Only the customer row is locked: the bill-to comes from the
 * customer's own Managed by and Bills go to columns (on the locked row), and an agency that still manages a
 * complex cannot be anonymised, so the agency needs no lock. An archived agency is still billed (issuing
 * resolves the bill-to again).
 */
async function draftForCustomer(
  tx: InvoiceStore,
  customerId: string,
  ctx: Context,
): Promise<Outcome> {
  const decide = async () => {
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        status: true,
        anonymisedAt: true,
        billingTiming: true,
        managedById: true,
        billsToManager: true,
      },
    });
    if (!customer) throw new DomainError("That customer could not be found.");
    if (customer.anonymisedAt) return skipped("anonymised");
    if (customer.status === "LEAD") return skipped("lead");
    if (customer.status === "PAUSED") return skipped("paused");
    if (customer.status === "ARCHIVED") return skipped("archived");
    const serviceMonth = serviceMonthFor(ctx.runMonth, customer.billingTiming);
    const existing = await tx.invoice.count({
      where: {
        customerId,
        kind: "MONTHLY",
        status: { not: "VOID" },
        serviceMonth: fromDateString(firstDayOf(serviceMonth)),
      },
    });
    if (existing > 0) return skipped("alreadyInvoiced");
    const agreements = await loadAgreements(tx, customerId, serviceMonth);
    if (agreements.length === 0) return skipped("notStarted");
    const serviceLines = serviceLinesFor(agreements, serviceMonth);
    // Nothing priced above zero: no draft (an empty or fee-only monthly draft would only confuse).
    if (serviceLines.length === 0) return skipped("nothingToBill");
    return { customer, serviceMonth, serviceLines };
  };

  const first = await decide();
  if ("reason" in first) return first;
  await lockCustomer(tx, customerId);
  const plan = await decide();
  if ("reason" in plan) return plan;

  const serviceLines = plan.serviceLines;
  const fees = await lateFeeLines(tx, customerId, ctx);
  const lines = [...serviceLines, ...fees].filter((l) => l.amountCents > 0);
  const created = await tx.invoice.create({
    data: {
      customerId,
      billToCustomerId: billToIdFor(plan.customer),
      kind: "MONTHLY",
      serviceMonth: fromDateString(firstDayOf(plan.serviceMonth)),
      dueDate: fromDateString(dueDateFor(ctx.runMonth, plan.customer.billingTiming)),
      createdById: ctx.actor.id,
      lines: { create: lines.map((l, index) => ({ ...l, sortOrder: index + 1 })) },
    },
    select: { id: true },
  });
  await logInvoiceEvent(tx, ctx.actor, "invoice.drafted", created.id, {
    kind: "MONTHLY",
    via: "run",
    lineCount: lines.length,
    lateFees: fees.length,
  });
  return { invoiceId: created.id };
}

/**
 * "Create this month's invoices": one draft per eligible monthly client for the run month, each customer in its
 * own transaction so one failure never blocks the rest. Idempotent: a second run skips customers that already
 * have a live monthly invoice for their service month (the partial unique index backs this up). Only drafts
 * are created; nothing is issued or emailed. `only` limits the run to these customer ids (tests, and running
 * it for one client); ids that are not UUIDs are ignored.
 */
export async function createMonthlyDrafts(
  store: InvoiceStore,
  actor: Actor,
  runMonth: string,
  deps: { run: TxRunner; only?: readonly string[]; today?: string },
): Promise<RunResult> {
  assertRole(actor, MANAGEMENT);
  const today = deps.today ?? todaySA();
  if (!runMonthAllowed(runMonth, today)) throw new DomainError(INVOICE_MESSAGES.runMonth);
  const settings = await readInvoiceSettings(store);
  const ctx: Context = { actor, runMonth, today, lateFeeCents: settings.lateFeeCents };

  const only = deps.only
    ? [...new Set(deps.only.filter(isUuid).map((id) => id.toLowerCase()))]
    : null;
  const rows = await store.quote.findMany({
    where: { ...BILLABLE_AGREEMENT, ...(only ? { customerId: { in: only } } : {}) },
    distinct: ["customerId"],
    orderBy: { customerId: "asc" },
    select: { customerId: true, customer: { select: { displayName: true } } },
  });

  const result: RunResult = { runMonth, created: [], skipped: [] };
  for (const row of rows) {
    const skip = (reason: RunSkipReason) =>
      result.skipped.push({
        customerId: row.customerId,
        displayName: row.customer.displayName,
        reason,
      });
    try {
      const outcome = await deps.run((tx) => draftForCustomer(tx, row.customerId, ctx));
      if ("invoiceId" in outcome) {
        result.created.push({ invoiceId: outcome.invoiceId, customerId: row.customerId });
      } else {
        skip(outcome.reason);
      }
    } catch (error) {
      // Unreachable today (the role is checked above), but a ForbiddenError stops the whole run: the drafts
      // already committed stay, and the caller gets no result listing them.
      if (error instanceof ForbiddenError) throw error;
      // Outside the transaction: a refusal by the once-a-month index has already rolled it back.
      if (isMonthlyDuplicate(error)) {
        skip("alreadyInvoiced");
      } else {
        // Fixed words only: never the error (it may hold names or addresses).
        console.error("A monthly invoice draft could not be created.");
        skip("failed");
      }
    }
  }
  return result;
}
