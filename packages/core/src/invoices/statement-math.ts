import { addDays, isValidDateString } from "../quotes/reference";
import { addMonths, firstDayOf, monthOf } from "./dates";

export type StatementInvoiceInput = {
  id: string;
  reference: string;
  /** South African date of issue, YYYY-MM-DD. */
  issuedOn: string;
  dueOn: string;
  totalCents: number;
  /** From payments that are not voided, as they stand now. */
  allocatedCents: number;
  /** The client the work was for (a complex, on an agency's statement). */
  customerId: string;
  customerName: string;
};

export type StatementPaymentInput = {
  id: string;
  receivedOn: string;
  amountCents: number;
  allocatedCents: number;
  reference: string | null;
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
};

export type StatementData = {
  from: string;
  to: string;
  openingCents: number;
  invoicedCents: number;
  paidCents: number;
  closingCents: number;
  /** Money received but not allocated to any invoice. */
  creditCents: number;
  entries: StatementEntry[];
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

/**
 * The statement for one bill-to customer. `invoices` are its ISSUED invoices (never void ones) and `payments`
 * its payments that are not voided; anything after `to` is ignored. Opening and closing balances are worked
 * out here, never stored. Positive balances are owed to ACE; a negative closing balance is money in credit.
 */
export function buildStatementData(input: {
  from: string;
  to: string;
  today: string;
  ownCustomerId: string;
  invoices: readonly StatementInvoiceInput[];
  payments: readonly StatementPaymentInput[];
}): StatementData {
  const invoices = input.invoices.filter((i) => i.issuedOn <= input.to);
  const payments = input.payments.filter((p) => p.receivedOn <= input.to);
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
    })),
  ].sort((a, b) =>
    a.date !== b.date
      ? a.date < b.date
        ? -1
        : 1
      : a.order !== b.order
        ? a.order - b.order
        : a.label < b.label
          ? -1
          : 1,
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
    };
  });

  const invoicedCents = inPeriod.reduce((t, i) => t + i.totalCents, 0);
  const paidCents = paidInPeriod.reduce((t, p) => t + p.amountCents, 0);
  const balanceOf = (i: StatementInvoiceInput) => Math.max(0, i.totalCents - i.allocatedCents);

  const outstanding = invoices
    .filter((i) => balanceOf(i) > 0)
    .sort((a, b) =>
      a.dueOn !== b.dueOn ? (a.dueOn < b.dueOn ? -1 : 1) : a.reference < b.reference ? -1 : 1,
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
      ...[...map.values()].sort((a, b) =>
        a.customerName < b.customerName ? -1 : a.customerName > b.customerName ? 1 : 0,
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
    creditCents: payments.reduce((t, p) => t + Math.max(0, p.amountCents - p.allocatedCents), 0),
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
