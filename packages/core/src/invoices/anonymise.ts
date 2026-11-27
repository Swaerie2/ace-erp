import type { Store } from "../customers/store";
import { ANONYMISED_LINE_DESCRIPTIONS, INVOICE_LINE_KINDS } from "./labels";

/** Invoices where the customer is the work customer or the bill-to. */
const mineWhere = (customerId: string) => ({
  OR: [{ customerId }, { billToCustomerId: customerId }],
});

/**
 * The invoice part of anonymising a customer. No role check: only `anonymiseCustomer` (owner, inside its
 * transaction, after locking the customer) calls it. Financial records stay (numbers, dates, amounts,
 * allocations); the frozen recipient, typed reasons, references and notes go, and line wording becomes a
 * fixed word per kind. Drafts (as the work customer or the bill-to) are deleted: they are not records yet.
 *
 * Whose data is whose, for a complex billed to its agency: the frozen recipient is the bill-to (the agency),
 * so it is scrubbed only when the bill-to is anonymised; the line wording names the work customer's
 * property, so it is scrubbed only when the work customer is anonymised; typed reasons and reported
 * references are free text that may name either, so they go when either is anonymised. A payment belongs to
 * its payer.
 */
export async function scrubInvoicesForAnonymise(
  store: Pick<Store, "invoice" | "invoiceLine" | "payment" | "paymentReport">,
  customerId: string,
): Promise<void> {
  const mine = mineWhere(customerId);
  await store.invoiceLine.deleteMany({ where: { invoice: { status: "DRAFT", ...mine } } });
  await store.invoice.deleteMany({ where: { status: "DRAFT", ...mine } });
  for (const kind of INVOICE_LINE_KINDS) {
    await store.invoiceLine.updateMany({
      where: { kind, invoice: { customerId } },
      data: { description: ANONYMISED_LINE_DESCRIPTIONS[kind] },
    });
  }
  await store.invoice.updateMany({
    where: { billToCustomerId: customerId },
    data: { recipientName: null, recipientAddress: null, voidReason: null },
  });
  await store.invoice.updateMany({
    where: { customerId, billToCustomerId: { not: customerId } },
    data: { voidReason: null },
  });
  await store.payment.updateMany({
    where: { payerCustomerId: customerId },
    data: { reference: null, note: null, voidReason: null },
  });
  await store.paymentReport.updateMany({
    where: { OR: [{ invoice: mine }, { reportedByContact: { customerId } }] },
    data: { reference: null },
  });
}

/**
 * The invoice part of the customer's data export. No role check: only `exportCustomerData` calls it.
 * ACE's own frozen bank and business details are left out. On an invoice for this customer's work that is
 * billed to someone else (a complex billed to its agency), the frozen recipient, the allocations and the
 * reported payments are the bill-to's data, so they are left out too.
 */
export async function invoiceExportFor(
  store: Pick<Store, "invoice" | "payment" | "paymentReport">,
  customerId: string,
) {
  const order = [{ createdAt: "asc" as const }, { id: "asc" as const }];
  const lines = { orderBy: { sortOrder: "asc" as const } };
  const billed = await store.invoice.findMany({
    where: { billToCustomerId: customerId },
    orderBy: order,
    // ACE's own bank and business details are not data about the customer.
    omit: { bankSnapshot: true },
    include: { lines, allocations: true },
  });
  const workOnly = await store.invoice.findMany({
    where: { customerId, billToCustomerId: { not: customerId } },
    orderBy: order,
    omit: { bankSnapshot: true, recipientName: true, recipientAddress: true },
    include: { lines },
  });
  const invoices = [...billed, ...workOnly].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const payments = await store.payment.findMany({
    where: { payerCustomerId: customerId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { allocations: true },
  });
  const paymentReports = await store.paymentReport.findMany({
    where: {
      OR: [{ invoice: { billToCustomerId: customerId } }, { reportedByContact: { customerId } }],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return { invoices, payments, paymentReports };
}
