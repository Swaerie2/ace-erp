import { z } from "zod";
import { assertRole, ForbiddenError, MANAGEMENT, type Actor } from "../customers/access";
import { lockCustomer } from "../customers/store";
import type { TxRunner } from "../portal/access";
import { fromDateString, todaySA } from "../quotes/reference";
import {
  catchUpDueDate,
  catchUpMonths,
  firstDayOf,
  lastDayOf,
  monthOf,
  startMonthCatchUpNeeded,
} from "./dates";
import { BILLABLE_AGREEMENT, loadAgreements, serviceLinesFor } from "./run";
import { billToIdFor, isMonthlyDuplicate, logInvoiceEvent, type InvoiceStore } from "./store";

/** Ids from the app are checked before they reach a uuid column (a bad one would make Postgres refuse). */
const isUuid = (value: string) => z.uuid().safeParse(value).success;

/** The most rows the Invoices page lists. */
const MAX_CANDIDATES = 200;

export type StartMonthCandidate = {
  customerId: string;
  customerNumber: number;
  customerName: string;
  /** The property (or properties, joined) whose first agreement starts in the month. */
  propertyLabel: string;
  /** The first service date ("YYYY-MM-DD"). */
  firstServiceOn: string;
  /** "YYYY-MM". */
  serviceMonth: string;
  amountPreviewCents: number;
};

export type StartMonthResult = {
  created: { invoiceId: string; customerId: string; serviceMonth: string }[];
  /** Customers looked at that needed nothing (or no longer did once locked). */
  skipped: number;
  failed: number;
};

/**
 * The customers that may need a catch-up: an ACTIVE customer that is not anonymised, with a billable agreement
 * starting (or, with no start date, accepted) from the first day of last month to the end of next month. Each
 * one is then checked properly by `planFor`.
 */
async function candidateCustomers(
  store: InvoiceStore,
  today: string,
  only: string[] | null,
  take?: number,
) {
  const months = catchUpMonths(today);
  const from = fromDateString(firstDayOf(months[0] ?? monthOf(today)));
  // A day early: an acceptance just after midnight in South Africa is still the day before in UTC.
  const acceptedFrom = new Date(from.getTime() - 24 * 60 * 60 * 1000);
  return store.quote.findMany({
    where: {
      ...BILLABLE_AGREEMENT,
      customer: { status: "ACTIVE", anonymisedAt: null },
      AND: [
        {
          OR: [
            {
              acceptedStartDate: {
                gte: from,
                lte: fromDateString(lastDayOf(months[months.length - 1] ?? monthOf(today))),
              },
            },
            { acceptedStartDate: null, acceptedAt: { gte: acceptedFrom } },
          ],
        },
      ],
      ...(only ? { customerId: { in: only } } : {}),
    },
    distinct: ["customerId"],
    orderBy: { customerId: "asc" },
    ...(take ? { take } : {}),
    select: { customerId: true },
  });
}

/**
 * Whether the customer needs a part-month (catch-up) draft for `serviceMonth`, and what it holds. Null when it
 * does not: the customer is not an active, non-anonymised customer; the month is not last, this or next month
 * or its normal run was not due yet (`startMonthCatchUpNeeded`); a live monthly invoice for the month exists;
 * or no property has its FIRST agreement starting in that month with something priced. The lines are built
 * exactly as the run builds them for that month (every agreement in force, a first agreement pro-rated),
 * with no late fees.
 */
async function planFor(
  store: InvoiceStore,
  customerId: string,
  serviceMonth: string,
  today: string,
) {
  const customer = await store.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      number: true,
      displayName: true,
      status: true,
      anonymisedAt: true,
      billingTiming: true,
      managedById: true,
      billsToManager: true,
    },
  });
  if (!customer || customer.anonymisedAt || customer.status !== "ACTIVE") return null;
  if (!startMonthCatchUpNeeded(serviceMonth, customer.billingTiming, today)) return null;
  const existing = await store.invoice.count({
    where: {
      customerId,
      kind: "MONTHLY",
      status: { not: "VOID" },
      serviceMonth: fromDateString(firstDayOf(serviceMonth)),
    },
  });
  if (existing > 0) return null;
  const agreements = await loadAgreements(store, customerId, serviceMonth);
  // A property's first agreement (nothing started before it) whose first service is in this month.
  const fresh = agreements.filter((a) => a.partMonth && monthOf(a.start) === serviceMonth);
  if (fresh.length === 0) return null;
  const serviceLines = serviceLinesFor(agreements, serviceMonth);
  const freshProperties = new Set(fresh.map((a) => a.propertyId));
  if (!serviceLines.some((l) => freshProperties.has(l.propertyId))) return null;
  return {
    customer,
    serviceMonth,
    serviceLines,
    propertyLabel: fresh.map((a) => a.property.label).join(", "),
    firstServiceOn: fresh.map((a) => a.start).sort()[0] ?? firstDayOf(serviceMonth),
  };
}

/**
 * Clients who need a part-month invoice: their first agreement started after the normal invoice run for that
 * month (Pre: the run on the 20th of the month before; Post: the 20th of the month), so no run bills those
 * first days. Last month, this month and next month only (next month: Pre clients from the 20th), at most 200
 * rows. Read only: nothing is written.
 */
export async function listStartMonthCandidates(
  store: InvoiceStore,
  actor: Actor,
  today: string = todaySA(),
): Promise<StartMonthCandidate[]> {
  assertRole(actor, MANAGEMENT);
  const rows = await candidateCustomers(store, today, null, MAX_CANDIDATES);
  const out: StartMonthCandidate[] = [];
  for (const row of rows) {
    for (const month of catchUpMonths(today)) {
      if (out.length >= MAX_CANDIDATES) return out;
      const plan = await planFor(store, row.customerId, month, today);
      if (!plan) continue;
      out.push({
        customerId: plan.customer.id,
        customerNumber: plan.customer.number,
        customerName: plan.customer.displayName,
        propertyLabel: plan.propertyLabel,
        firstServiceOn: plan.firstServiceOn,
        serviceMonth: plan.serviceMonth,
        amountPreviewCents: plan.serviceLines.reduce((t, l) => t + l.amountCents, 0),
      });
    }
  }
  return out;
}

/** One customer, inside its own transaction: unlocked look, lock the customer, look again, then write. */
async function catchUpCustomer(
  tx: InvoiceStore,
  actor: Actor,
  customerId: string,
  today: string,
): Promise<StartMonthResult["created"]> {
  const created: StartMonthResult["created"] = [];
  for (const month of catchUpMonths(today)) {
    if (!(await planFor(tx, customerId, month, today))) continue;
    await lockCustomer(tx, customerId);
    const plan = await planFor(tx, customerId, month, today);
    if (!plan) continue;
    const lines = plan.serviceLines.filter((l) => l.amountCents > 0);
    const invoice = await tx.invoice.create({
      data: {
        customerId,
        billToCustomerId: billToIdFor(plan.customer),
        kind: "MONTHLY",
        serviceMonth: fromDateString(firstDayOf(month)),
        dueDate: fromDateString(catchUpDueDate(month, plan.customer.billingTiming, today)),
        createdById: actor.id,
        lines: { create: lines.map((l, index) => ({ ...l, sortOrder: index + 1 })) },
      },
      select: { id: true },
    });
    await logInvoiceEvent(tx, actor, "invoice.drafted", invoice.id, {
      kind: "MONTHLY",
      via: "catchup",
      lineCount: lines.length,
    });
    created.push({ invoiceId: invoice.id, customerId, serviceMonth: month });
  }
  return created;
}

/**
 * "Create part-month invoices": a DRAFT for each client in `listStartMonthCandidates` (or only these customer
 * ids; ids that are not UUIDs are ignored), each customer in its own transaction, so one failure never blocks
 * the rest and never throws. Idempotent: a live monthly invoice for the month stops a second one (the partial
 * unique index backs this up). The monthly run itself is unchanged; the staff app calls this after it.
 */
export async function createStartMonthDrafts(
  store: InvoiceStore,
  actor: Actor,
  deps: { run: TxRunner; only?: readonly string[]; today?: string },
): Promise<StartMonthResult> {
  assertRole(actor, MANAGEMENT);
  const today = deps.today ?? todaySA();
  const only = deps.only
    ? [...new Set(deps.only.filter(isUuid).map((id) => id.toLowerCase()))]
    : null;
  const result: StartMonthResult = { created: [], skipped: 0, failed: 0 };
  if (only && only.length === 0) return result;
  const rows = await candidateCustomers(store, today, only);
  for (const row of rows) {
    try {
      const made = await deps.run((tx) => catchUpCustomer(tx, actor, row.customerId, today));
      if (made.length > 0) result.created.push(...made);
      else result.skipped += 1;
    } catch (error) {
      if (error instanceof ForbiddenError) throw error;
      // Outside the transaction: a refusal by the once-a-month index has already rolled it back.
      if (isMonthlyDuplicate(error)) {
        result.skipped += 1;
      } else {
        // Fixed words only: never the error (it may hold names or addresses).
        console.error("A part-month invoice draft could not be created.");
        result.failed += 1;
      }
    }
  }
  return result;
}
