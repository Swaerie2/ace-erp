import { z } from "zod";
import { assertRole, ForbiddenError, MANAGEMENT, type Actor } from "../customers/access";
import { lockCustomer } from "../customers/store";
import type { TxRunner } from "../portal/access";
import { fromDateString, toDateString, todaySA } from "../quotes/reference";
import {
  catchUpDueDate,
  catchUpMonths,
  firstDayOf,
  monthOf,
  runDateFor,
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
  /** The property (or properties, joined) whose agreement was accepted after that month's run date. */
  propertyLabel: string;
  /** That agreement's first service date ("YYYY-MM-DD"), possibly before the month. */
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
 * accepted on or after the earliest run date a catch-up month can have (the Pre run date of last month). Each
 * one is then checked properly by `planCustomer`.
 */
async function candidateCustomers(
  store: InvoiceStore,
  today: string,
  only: string[] | null,
  take?: number,
) {
  const earliest = fromDateString(runDateFor(catchUpMonths(today)[0] ?? monthOf(today), "PRE"));
  // A day early: an acceptance just after midnight in South Africa is still the day before in UTC.
  const acceptedFrom = new Date(earliest.getTime() - 24 * 60 * 60 * 1000);
  return store.quote.findMany({
    where: {
      ...BILLABLE_AGREEMENT,
      customer: { status: "ACTIVE", anonymisedAt: null },
      acceptedAt: { gte: acceptedFrom },
      ...(only ? { customerId: { in: only } } : {}),
    },
    distinct: ["customerId"],
    orderBy: { customerId: "asc" },
    ...(take ? { take } : {}),
    select: { customerId: true },
  });
}

/**
 * The catch-up drafts one customer needs, oldest month first, and what each holds. A month M (last month,
 * this month or next month) needs one when ALL hold: the customer is ACTIVE and not anonymised; the normal
 * run for M is due (`runDateFor`: Pre the 20th of the month before, Post the 20th of M); an agreement in force
 * for M (the run's own `loadAgreements`, replacements included) with something priced was ACCEPTED (South
 * African date of `acceptedAt`) on or after that run date, so the run could not have billed it in time; and
 * no live monthly invoice exists for M. The lines are exactly what the run builds for M (every agreement in
 * force; only a first agreement starting after the 1st of M is pro-rated), with no late fees. The list and
 * the create both use this, so the box never shows a client the create would skip.
 */
async function planCustomer(store: InvoiceStore, customerId: string, today: string) {
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
  if (!customer || customer.anonymisedAt || customer.status !== "ACTIVE") return [];
  const months = catchUpMonths(today).filter((m) => today >= runDateFor(m, customer.billingTiming));
  if (months.length === 0) return [];
  const invoiced = new Set(
    (
      await store.invoice.findMany({
        where: {
          customerId,
          kind: "MONTHLY",
          status: { not: "VOID" },
          serviceMonth: { in: months.map((m) => fromDateString(firstDayOf(m))) },
        },
        select: { serviceMonth: true },
      })
    ).flatMap((i) => (i.serviceMonth ? [toDateString(i.serviceMonth).slice(0, 7)] : [])),
  );
  const plans = [];
  for (const serviceMonth of months) {
    if (invoiced.has(serviceMonth)) continue;
    const agreements = await loadAgreements(store, customerId, serviceMonth);
    const serviceLines = serviceLinesFor(agreements, serviceMonth);
    const priced = new Set(serviceLines.map((l) => l.propertyId));
    const late = agreements.filter(
      (a) =>
        a.acceptedAt !== null &&
        priced.has(a.propertyId) &&
        startMonthCatchUpNeeded(serviceMonth, customer.billingTiming, today, todaySA(a.acceptedAt)),
    );
    if (late.length === 0) continue;
    plans.push({
      customer,
      serviceMonth,
      serviceLines,
      propertyLabel: late.map((a) => a.property.label).join(", "),
      firstServiceOn: late.map((a) => a.start).sort()[0] ?? firstDayOf(serviceMonth),
    });
  }
  return plans;
}

/**
 * Clients who need a catch-up (often part-month) invoice: they accepted after the normal invoice run for that
 * month (Pre: the run on the 20th of the month before; Post: the 20th of the month), so no run bills it. Last
 * month, this month and next month only (next month: Pre clients from the 20th), one row per client and
 * month, at most 200 rows. Read only: nothing is written.
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
    for (const plan of await planCustomer(store, row.customerId, today)) {
      if (out.length >= MAX_CANDIDATES) return out;
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
  if ((await planCustomer(tx, customerId, today)).length === 0) return created;
  await lockCustomer(tx, customerId);
  for (const plan of await planCustomer(tx, customerId, today)) {
    const month = plan.serviceMonth;
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
 * "Create part-month invoices": the DRAFTS for each client in `listStartMonthCandidates` (or only these customer
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
