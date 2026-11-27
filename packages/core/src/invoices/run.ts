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

/** The same notion of "current monthly agreement" as `getPropertyAgreement`, on a property still in use. */
const CURRENT_AGREEMENT = {
  status: "ACCEPTED",
  agreementEndedAt: null,
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

/** The current agreement of each of the customer's properties (the latest accepted), sorted by label. */
async function loadAgreements(tx: InvoiceStore, customerId: string) {
  const quotes = await tx.quote.findMany({
    where: { customerId, ...CURRENT_AGREEMENT },
    orderBy: [{ acceptedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      propertyId: true,
      acceptedAt: true,
      acceptedStartDate: true,
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
  const byProperty = new Map<string, (typeof quotes)[number]>();
  for (const q of quotes) if (!byProperty.has(q.propertyId)) byProperty.set(q.propertyId, q);
  return [...byProperty.values()]
    .map((q) => ({
      ...q,
      start: q.acceptedStartDate
        ? toDateString(q.acceptedStartDate)
        : todaySA(q.acceptedAt ?? new Date()),
    }))
    .sort((a, b) =>
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
    const monthEnd = lastDayOf(serviceMonth);
    const agreements = (await loadAgreements(tx, customerId)).filter((a) => a.start <= monthEnd);
    if (agreements.length === 0) return skipped("notStarted");
    return { customer, serviceMonth, agreements };
  };

  const first = await decide();
  if ("reason" in first) return first;
  await lockCustomer(tx, customerId);
  const plan = await decide();
  if ("reason" in plan) return plan;

  const serviceLines = plan.agreements.flatMap((a) =>
    a.lines
      .filter(
        (l) =>
          l.billing === "MONTHLY" &&
          (l.lineKind === "PRICED" || (l.lineKind === "OPTIONAL" && l.chosen)) &&
          (l.amountCents ?? 0) > 0,
      )
      .map((l) => {
        const base = `${a.property.label}: ${l.description}`;
        const part = proRata(l.amountCents ?? 0, a.start, plan.serviceMonth);
        return {
          kind: l.lineKind === "PRICED" ? ("SERVICE" as const) : ("OPTIONAL" as const),
          description: fitDescription(
            part
              ? `${base} (part month: ${part.days} of ${part.daysInMonth} days from ${formatDayMonth(a.start)})`
              : base,
          ),
          amountCents: part ? part.amountCents : (l.amountCents ?? 0),
          propertyId: a.propertyId,
          sourceQuoteLineId: l.id,
        };
      }),
  );
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
    where: { ...CURRENT_AGREEMENT, ...(only ? { customerId: { in: only } } : {}) },
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
