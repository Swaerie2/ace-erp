import { addDays, isValidDateString } from "../quotes/reference";
import { addMonths, firstDayOf, monthOf } from "./dates";

export type StatementInvoiceInput = {
  id: string;
  reference: string;
  /** South African date of issue, YYYY-MM-DD. */
  issuedOn: string;
  dueOn: string;
  totalCents: number;
  /** The client the work was for (a complex, on an agency's statement). */
  customerId: string;
  customerName: string;
};

export type StatementPaymentInput = {
  id: string;
  receivedOn: string;
  amountCents: number;
  reference: string | null;
};

/** One allocation of a payment to an invoice. The caller supplies only allocations of payments that are not voided. */
export type StatementAllocationInput = {
  paymentId: string;
  invoiceId: string;
  amountCents: number;
};

export type StatementEntry = {
  id: string;
  date: string;
  kind: "INVOICE" | "PAYMENT";
  label: string;
  /** The complex, on an agency's statement; null otherwise. */
  customerName: string | null;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
  /** Payments only: the invoices this payment settled as at the end of the period, by reference. Empty for invoices. */
  allocations: { invoiceId: string; reference: string; amountCents: number }[];
};

export type StatementData = {
  from: string;
  to: string;
  openingCents: number;
  invoicedCents: number;
  paidCents: number;
  closingCents: number;
  /** Money received on or before `to` that is not allocated to any invoice issued on or before `to`. */
  creditCents: number;
  entries: StatementEntry[];
  /** Invoices issued on or before `to` with a balance left as at `to`. */
  outstanding: {
    id: string;
    reference: string;
    customerName: string | null;
    dueOn: string;
    balanceCents: number;
    overdue: boolean;
  }[];
  /** Agencies only: one row per complex, sorted by name. Empty for an ordinary customer. */
  byComplex: {
    customerId: string;
    customerName: string;
    invoicedCents: number;
    outstandingCents: number;
  }[];
};

/** A proper total order on strings (never returns 0 for different strings). */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The statement for one bill-to customer, worked out entirely as at `to`.
 *
 * `invoices` are its ISSUED invoices and `payments` its payments received; the caller must leave out void
 * invoices and voided payments (and their allocations). Anything issued or received after `to` is ignored.
 * An allocation has no date of its own, so the payment's received date is used: it counts only when its
 * payment was received on or before `to` AND its invoice was issued on or before `to`. Outstanding balances,
 * per-complex totals, the credit and the allocation detail on each payment are all derived from the allocations
 * that count, so the statement reconciles the same way whenever it is printed.
 *
 * Opening and closing balances are worked out here, never stored. Positive balances are owed to ACE; a
 * negative closing balance is money in credit. closing = opening + invoiced - paid.
 */
export function buildStatementData(input: {
  from: string;
  to: string;
  today: string;
  ownCustomerId: string;
  invoices: readonly StatementInvoiceInput[];
  payments: readonly StatementPaymentInput[];
  allocations: readonly StatementAllocationInput[];
}): StatementData {
  const invoices = input.invoices.filter((i) => i.issuedOn <= input.to);
  const payments = input.payments.filter((p) => p.receivedOn <= input.to);
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const paymentIds = new Set(payments.map((p) => p.id));
  const counted = input.allocations.filter(
    (a) => paymentIds.has(a.paymentId) && invoiceById.has(a.invoiceId),
  );
  const allocatedToInvoice = new Map<string, number>();
  const allocatedFromPayment = new Map<string, number>();
  for (const a of counted) {
    allocatedToInvoice.set(a.invoiceId, (allocatedToInvoice.get(a.invoiceId) ?? 0) + a.amountCents);
    allocatedFromPayment.set(
      a.paymentId,
      (allocatedFromPayment.get(a.paymentId) ?? 0) + a.amountCents,
    );
  }
  const paymentAllocations = (paymentId: string): StatementEntry["allocations"] => {
    const byInvoice = new Map<string, number>();
    for (const a of counted) {
      if (a.paymentId === paymentId) {
        byInvoice.set(a.invoiceId, (byInvoice.get(a.invoiceId) ?? 0) + a.amountCents);
      }
    }
    return [...byInvoice.entries()]
      .map(([invoiceId, amountCents]) => ({
        invoiceId,
        reference: invoiceById.get(invoiceId)?.reference ?? "",
        amountCents,
      }))
      .sort((a, b) => compare(a.reference, b.reference) || compare(a.invoiceId, b.invoiceId));
  };

  const forAgency = invoices.some((i) => i.customerId !== input.ownCustomerId);
  const nameFor = (i: StatementInvoiceInput) => (forAgency ? i.customerName : null);

  const before = (date: string) => date < input.from;
  const openingCents =
    invoices.filter((i) => before(i.issuedOn)).reduce((t, i) => t + i.totalCents, 0) -
    payments.filter((p) => before(p.receivedOn)).reduce((t, p) => t + p.amountCents, 0);

  const inPeriod = invoices.filter((i) => !before(i.issuedOn));
  const paidInPeriod = payments.filter((p) => !before(p.receivedOn));
  const raw = [
    ...inPeriod.map((i) => ({
      id: i.id,
      date: i.issuedOn,
      kind: "INVOICE" as const,
      label: `Invoice ${i.reference}`,
      customerName: nameFor(i),
      debitCents: i.totalCents,
      creditCents: 0,
      order: 0,
      allocations: [] as StatementEntry["allocations"],
    })),
    ...paidInPeriod.map((p) => ({
      id: p.id,
      date: p.receivedOn,
      kind: "PAYMENT" as const,
      label: p.reference ? `Payment received, ref ${p.reference}` : "Payment received",
      customerName: null,
      debitCents: 0,
      creditCents: p.amountCents,
      order: 1,
      allocations: paymentAllocations(p.id),
    })),
  ].sort(
    (a, b) =>
      compare(a.date, b.date) ||
      a.order - b.order ||
      compare(a.label, b.label) ||
      compare(a.id, b.id),
  );
  let running = openingCents;
  const entries: StatementEntry[] = raw.map((e) => {
    running += e.debitCents - e.creditCents;
    return {
      id: e.id,
      date: e.date,
      kind: e.kind,
      label: e.label,
      customerName: e.customerName,
      debitCents: e.debitCents,
      creditCents: e.creditCents,
      balanceCents: running,
      allocations: e.allocations,
    };
  });

  const invoicedCents = inPeriod.reduce((t, i) => t + i.totalCents, 0);
  const paidCents = paidInPeriod.reduce((t, p) => t + p.amountCents, 0);
  const balanceOf = (i: StatementInvoiceInput) =>
    Math.max(0, i.totalCents - (allocatedToInvoice.get(i.id) ?? 0));

  const outstanding = invoices
    .filter((i) => balanceOf(i) > 0)
    .sort(
      (a, b) =>
        compare(a.dueOn, b.dueOn) || compare(a.reference, b.reference) || compare(a.id, b.id),
    )
    .map((i) => ({
      id: i.id,
      reference: i.reference,
      customerName: nameFor(i),
      dueOn: i.dueOn,
      balanceCents: balanceOf(i),
      overdue: i.dueOn < input.today,
    }));

  const byComplex: StatementData["byComplex"] = [];
  if (forAgency) {
    const map = new Map<string, StatementData["byComplex"][number]>();
    for (const i of invoices) {
      const row = map.get(i.customerId) ?? {
        customerId: i.customerId,
        customerName: i.customerName,
        invoicedCents: 0,
        outstandingCents: 0,
      };
      if (!before(i.issuedOn)) row.invoicedCents += i.totalCents;
      row.outstandingCents += balanceOf(i);
      map.set(i.customerId, row);
    }
    byComplex.push(
      ...[...map.values()].sort(
        (a, b) => compare(a.customerName, b.customerName) || compare(a.customerId, b.customerId),
      ),
    );
  }

  return {
    from: input.from,
    to: input.to,
    openingCents,
    invoicedCents,
    paidCents,
    closingCents: openingCents + invoicedCents - paidCents,
    creditCents: payments.reduce(
      (t, p) => t + Math.max(0, p.amountCents - (allocatedFromPayment.get(p.id) ?? 0)),
      0,
    ),
    entries,
    outstanding,
    byComplex,
  };
}

/** The first day of the month two months back, until today. */
export function defaultStatementPeriod(today: string): { from: string; to: string } {
  return { from: firstDayOf(addMonths(monthOf(today), -2)), to: today };
}

export const MAX_STATEMENT_DAYS = 1100;

/** A plain sentence when the period cannot be used, else null. */
export function statementPeriodProblem(from: string, to: string): string | null {
  if (!isValidDateString(from) || !isValidDateString(to)) return "Choose valid dates.";
  if (from > to) return "The start date must be on or before the end date.";
  if (addDays(from, MAX_STATEMENT_DAYS) < to) return "Choose a period of three years or less.";
  return null;
}
