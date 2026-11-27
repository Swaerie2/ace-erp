import { z } from "zod";
import { assertRole, DomainError, MANAGEMENT, type Actor } from "../customers/access";
import { toDateString, todaySA } from "../quotes/reference";
import { formatBillingAddress } from "./money";
import { formatInvoiceReference } from "./reference";
import { buildStatementData, statementPeriodProblem, type StatementData } from "./statement-math";
import type { InvoiceStore } from "./store";

/** Ids from the app are checked before they reach a uuid column (a bad one would make Postgres refuse). */
const isUuid = (value: string) => z.uuid().safeParse(value).success;

/**
 * The statement of one paying (bill-to) customer for a period: its issued invoices, for any of its complexes,
 * and its payments that are not voided. Worked out on demand as at the end of the period; nothing is stored.
 *
 * It loads the customer's FULL history (every issued invoice and every payment that is not voided, not only
 * those in the period), because the opening balance and the balances as at the end date need all of it.
 * Fine at the size of this business; revisit it if one customer ever has tens of thousands of invoices.
 *
 * Null for an unknown (or malformed) customer id. A bad period throws a DomainError with a plain sentence;
 * the period is checked before the database is touched.
 */
export async function getStatement(
  store: InvoiceStore,
  actor: Actor,
  customerId: string,
  period: { from: string; to: string },
): Promise<{
  customer: { id: string; number: number; displayName: string; address: string | null };
  data: StatementData;
} | null> {
  assertRole(actor, MANAGEMENT);
  const problem = statementPeriodProblem(period.from, period.to);
  if (problem) throw new DomainError(problem);
  if (!isUuid(customerId)) return null;
  const id = customerId.toLowerCase();

  const customer = await store.customer.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      displayName: true,
      billingLine1: true,
      billingLine2: true,
      billingSuburb: true,
      billingCity: true,
      billingPostalCode: true,
    },
  });
  if (!customer) return null;

  // Only ISSUED invoices: drafts and void invoices never count (so no allocation to a void invoice can count).
  const invoices = await store.invoice.findMany({
    where: { billToCustomerId: id, status: "ISSUED" },
    select: {
      id: true,
      numberYear: true,
      numberSeq: true,
      issuedAt: true,
      dueDate: true,
      totalCents: true,
      customer: { select: { id: true, displayName: true } },
    },
  });
  const payments = await store.payment.findMany({
    where: { payerCustomerId: id, voidedAt: null },
    select: { id: true, receivedOn: true, amountCents: true, reference: true },
  });
  const allocations = await store.paymentAllocation.findMany({
    where: { paymentId: { in: payments.map((p) => p.id) } },
    select: { paymentId: true, invoiceId: true, amountCents: true },
  });

  const data = buildStatementData({
    from: period.from,
    to: period.to,
    today: todaySA(),
    ownCustomerId: id,
    invoices: invoices.map((i) => {
      const reference = formatInvoiceReference(i);
      // The database guarantees an issued invoice has a date of issue, a due date and a total, but not a number.
      // A statement must never print a blank or made-up reference, and must not silently leave an invoice out.
      if (reference === null || i.issuedAt === null || i.totalCents === null) {
        throw new DomainError(
          "An issued invoice is missing its number or amount, so the statement cannot be worked out. Please tell support.",
        );
      }
      const issuedOn = todaySA(i.issuedAt);
      return {
        id: i.id,
        reference,
        issuedOn,
        dueOn: i.dueDate ? toDateString(i.dueDate) : issuedOn,
        totalCents: i.totalCents,
        customerId: i.customer.id,
        customerName: i.customer.displayName,
      };
    }),
    payments: payments.map((p) => ({
      id: p.id,
      receivedOn: toDateString(p.receivedOn),
      amountCents: p.amountCents,
      reference: p.reference,
    })),
    allocations,
  });
  return {
    customer: {
      id: customer.id,
      number: customer.number,
      displayName: customer.displayName,
      address: formatBillingAddress(customer),
    },
    data,
  };
}
