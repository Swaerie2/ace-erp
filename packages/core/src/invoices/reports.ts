import { z } from "zod";
import { assertRole, DomainError, MANAGEMENT, type Actor } from "../customers/access";
import { toDateString } from "../quotes/reference";
import { formatInvoiceReference } from "./reference";
import { INVOICE_MESSAGES, lockReportRow, logInvoiceEvent, type InvoiceStore } from "./store";

/** Ids from the app are checked before they reach a uuid column (a bad one would make Postgres refuse). */
const isUuid = (value: string) => z.uuid().safeParse(value).success;

/** "I have paid" reports (written by the portal in stage 5b). Waiting ones by default, newest first, at most 200. */
export async function listPaymentReports(
  store: InvoiceStore,
  actor: Actor,
  query: { status?: "WAITING" | "ALL" } = {},
) {
  assertRole(actor, MANAGEMENT);
  const rows = await store.paymentReport.findMany({
    where: query.status === "ALL" ? {} : { status: "WAITING" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
    select: {
      id: true,
      paidOn: true,
      reference: true,
      status: true,
      createdAt: true,
      reportedByContact: { select: { name: true } },
      invoice: {
        select: {
          id: true,
          numberYear: true,
          numberSeq: true,
          totalCents: true,
          customer: { select: { id: true, displayName: true } },
          billTo: { select: { id: true, number: true, displayName: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    paidOn: toDateString(r.paidOn),
    reference: r.reference,
    status: r.status,
    createdAt: r.createdAt,
    reportedBy: r.reportedByContact?.name ?? null,
    invoice: {
      id: r.invoice.id,
      reference: formatInvoiceReference(r.invoice),
      totalCents: r.invoice.totalCents,
      customer: r.invoice.customer,
      billTo: r.invoice.billTo,
    },
  }));
}

/** For pre-filling the record-payment form from a report. Null when there is none. */
export async function getPaymentReport(store: InvoiceStore, actor: Actor, id: string) {
  assertRole(actor, MANAGEMENT);
  if (!isUuid(id)) return null;
  const r = await store.paymentReport.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      paidOn: true,
      reference: true,
      invoiceId: true,
      invoice: { select: { billToCustomerId: true } },
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    status: r.status,
    paidOn: toDateString(r.paidOn),
    reference: r.reference,
    invoiceId: r.invoiceId,
    billToCustomerId: r.invoice.billToCustomerId,
  };
}

/** "Dismiss": the money was not found on the bank statement. Lock: the report (nothing else is written). */
export async function dismissPaymentReport(
  store: InvoiceStore,
  actor: Actor,
  id: string,
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  if (!isUuid(id)) throw new DomainError(INVOICE_MESSAGES.reportNotFound);
  const read = async () => {
    const r = await store.paymentReport.findUnique({
      where: { id },
      select: { id: true, status: true, invoiceId: true },
    });
    if (!r) throw new DomainError(INVOICE_MESSAGES.reportNotFound);
    if (r.status !== "WAITING") throw new DomainError(INVOICE_MESSAGES.reportResolved);
    return r;
  };
  await read();
  await lockReportRow(store, id);
  const r = await read();
  const { count } = await store.paymentReport.updateMany({
    where: { id: r.id, status: "WAITING" },
    data: { status: "DISMISSED", resolvedAt: new Date(), resolvedById: actor.id },
  });
  if (count !== 1) throw new DomainError(INVOICE_MESSAGES.reportResolved);
  await logInvoiceEvent(store, actor, "invoice.report_dismissed", r.invoiceId, { reportId: r.id });
}
