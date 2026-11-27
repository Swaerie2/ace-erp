import { z } from "zod";
import { assertRole, DomainError, MANAGEMENT, type Actor } from "../customers/access";
import { findEditableCustomer, lockCustomer } from "../customers/store";
import { fromDateString, isValidDateString, toDateString, todaySA } from "../quotes/reference";
import { MAX_PAYMENT_CENTS } from "./money";
import { formatInvoiceReference } from "./reference";
import {
  EARLIEST_PAYMENT_DATE,
  MAX_NOTE,
  MAX_REFERENCE,
  reasonSchema,
  type PaymentInput,
} from "./schemas";
import {
  allocatedByInvoice,
  allocatedByPayment,
  INVOICE_MESSAGES,
  lockInvoiceRows,
  lockPaymentRow,
  lockReportRow,
  logInvoiceEvent,
  logPaymentEvent,
  type InvoiceStore,
} from "./store";

type Allocation = { invoiceId: string; amountCents: number };

/** Ids from the app are checked before they reach a uuid column (a bad one would make Postgres refuse). */
const isUuid = (value: string) => z.uuid().safeParse(value).success;
const ALLOCATION_NOT_FOUND = "That allocation could not be found.";

function checkPaymentInput(input: PaymentInput, today: string): void {
  if (!isUuid(input.payerCustomerId)) throw new DomainError("That customer could not be found.");
  if (input.reportId !== null && !isUuid(input.reportId)) {
    throw new DomainError(INVOICE_MESSAGES.reportNotFound);
  }
  if (
    !isValidDateString(input.receivedOn) ||
    input.receivedOn < EARLIEST_PAYMENT_DATE ||
    input.receivedOn > today
  ) {
    throw new DomainError("Choose the date the money arrived (not in the future).");
  }
  if (
    !Number.isSafeInteger(input.amountCents) ||
    input.amountCents <= 0 ||
    input.amountCents > MAX_PAYMENT_CENTS
  ) {
    throw new DomainError("Enter the amount received, for example 1150.00.");
  }
  if ((input.reference ?? "").length > MAX_REFERENCE || (input.note ?? "").length > MAX_NOTE) {
    throw new DomainError("Keep the reference to 100 characters and the note to 500.");
  }
  if (input.allocations.some((a) => !isUuid(a.invoiceId)))
    throw new DomainError(INVOICE_MESSAGES.notFound);
  // Lowercased, so the same invoice in another case is still a duplicate (and never meets the unique pair).
  const ids = input.allocations.map((a) => a.invoiceId.toLowerCase());
  if (new Set(ids).size !== ids.length) throw new DomainError(INVOICE_MESSAGES.duplicateInvoice);
  if (input.allocations.some((a) => !Number.isSafeInteger(a.amountCents) || a.amountCents <= 0)) {
    throw new DomainError("Each amount allocated must be above zero.");
  }
  if (input.allocations.reduce((t, a) => t + a.amountCents, 0) > input.amountCents) {
    throw new DomainError("The amounts allocated add up to more than the payment.");
  }
}

/** Every invoice must be issued, billed to the payer, and still owe at least the amount allocated to it. */
async function checkAllocations(
  store: InvoiceStore,
  payerId: string,
  allocations: readonly Allocation[],
) {
  if (allocations.length === 0) return;
  const ids = allocations.map((a) => a.invoiceId);
  const invoices = await store.invoice.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, billToCustomerId: true, totalCents: true },
  });
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const allocated = await allocatedByInvoice(store, ids);
  for (const a of allocations) {
    const inv = byId.get(a.invoiceId);
    if (!inv) throw new DomainError(INVOICE_MESSAGES.notFound);
    if (inv.status !== "ISSUED") throw new DomainError(INVOICE_MESSAGES.notIssued);
    if (inv.billToCustomerId !== payerId) throw new DomainError(INVOICE_MESSAGES.notPayersInvoice);
    if (a.amountCents > (inv.totalCents ?? 0) - (allocated.get(inv.id) ?? 0)) {
      throw new DomainError(INVOICE_MESSAGES.overBalance);
    }
  }
}

async function checkReport(store: InvoiceStore, reportId: string, payerId: string) {
  const report = await store.paymentReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      status: true,
      invoiceId: true,
      invoice: { select: { billToCustomerId: true } },
    },
  });
  if (!report) throw new DomainError(INVOICE_MESSAGES.reportNotFound);
  if (report.status !== "WAITING") throw new DomainError(INVOICE_MESSAGES.reportResolved);
  if (report.invoice.billToCustomerId !== payerId)
    throw new DomainError(INVOICE_MESSAGES.notPayersInvoice);
  return report;
}

/**
 * Records money received by EFT, optionally split over the payer's invoices, optionally confirming a reported
 * payment. Lock order: the payer, the invoices (by id), then the report. Every check is repeated after the
 * locks (the invoices still ISSUED, billed to the payer and owing enough). Unallocated money is a credit.
 * The reference and note are stored on the payment only, never in the audit lines.
 */
export async function recordPayment(
  store: InvoiceStore,
  actor: Actor,
  input: PaymentInput,
): Promise<{ id: string }> {
  assertRole(actor, MANAGEMENT);
  checkPaymentInput(input, todaySA());
  // Lowercased ids, so comparisons with the ids read back from the database hold.
  const payerId = input.payerCustomerId.toLowerCase();
  const reportId = input.reportId?.toLowerCase() ?? null;
  const allocations = input.allocations.map((a) => ({
    invoiceId: a.invoiceId.toLowerCase(),
    amountCents: a.amountCents,
  }));
  const check = async () => {
    await findEditableCustomer(store, payerId);
    await checkAllocations(store, payerId, allocations);
    if (reportId) await checkReport(store, reportId, payerId);
  };
  await check();
  await lockCustomer(store, payerId);
  await lockInvoiceRows(
    store,
    allocations.map((a) => a.invoiceId),
  );
  await check();

  const payment = await store.payment.create({
    data: {
      payerCustomerId: payerId,
      receivedOn: fromDateString(input.receivedOn),
      amountCents: input.amountCents,
      reference: input.reference,
      note: input.note,
      recordedById: actor.id,
      allocations: { create: allocations },
    },
    select: { id: true },
  });

  if (reportId) {
    await lockReportRow(store, reportId);
    const report = await checkReport(store, reportId, payerId);
    const { count } = await store.paymentReport.updateMany({
      where: { id: report.id, status: "WAITING" },
      data: { status: "CONFIRMED", resolvedAt: new Date(), resolvedById: actor.id },
    });
    if (count !== 1) throw new DomainError(INVOICE_MESSAGES.reportResolved);
    await logInvoiceEvent(store, actor, "invoice.report_confirmed", report.invoiceId, {
      reportId: report.id,
      paymentId: payment.id,
    });
  }
  await logPaymentEvent(store, actor, "payment.recorded", payment.id, {
    allocationCount: allocations.length,
    fromReport: reportId !== null,
  });
  for (const a of allocations) {
    await logInvoiceEvent(store, actor, "invoice.payment_allocated", a.invoiceId, {
      paymentId: payment.id,
    });
  }
  return payment;
}

/**
 * Allocates part of a payment's unallocated money to one invoice, adding to an existing allocation for the
 * same pair. Lock order: payer, invoice, payment; every check is repeated after the locks.
 */
export async function allocatePayment(
  store: InvoiceStore,
  actor: Actor,
  input: { paymentId: string; invoiceId: string; amountCents: number },
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  if (!isUuid(input.paymentId)) throw new DomainError(INVOICE_MESSAGES.paymentNotFound);
  if (!isUuid(input.invoiceId)) throw new DomainError(INVOICE_MESSAGES.notFound);
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new DomainError("Enter an amount above zero.");
  }
  const paymentId = input.paymentId.toLowerCase();
  const allocation = { invoiceId: input.invoiceId.toLowerCase(), amountCents: input.amountCents };
  const check = async () => {
    const p = await store.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, payerCustomerId: true, amountCents: true, voidedAt: true },
    });
    if (!p) throw new DomainError(INVOICE_MESSAGES.paymentNotFound);
    if (p.voidedAt) throw new DomainError(INVOICE_MESSAGES.paymentVoided);
    await checkAllocations(store, p.payerCustomerId, [allocation]);
    const used = (await allocatedByPayment(store, [p.id])).get(p.id) ?? 0;
    if (allocation.amountCents > p.amountCents - used)
      throw new DomainError(INVOICE_MESSAGES.overPayment);
    return p;
  };
  const first = await check();
  await lockCustomer(store, first.payerCustomerId);
  await lockInvoiceRows(store, [allocation.invoiceId]);
  await lockPaymentRow(store, paymentId);
  await check();
  const existing = await store.paymentAllocation.findUnique({
    where: { paymentId_invoiceId: { paymentId, invoiceId: allocation.invoiceId } },
    select: { id: true },
  });
  if (existing) {
    await store.paymentAllocation.update({
      where: { id: existing.id },
      data: { amountCents: { increment: allocation.amountCents } },
      select: { id: true },
    });
  } else {
    await store.paymentAllocation.create({
      data: { paymentId, invoiceId: allocation.invoiceId, amountCents: allocation.amountCents },
      select: { id: true },
    });
  }
  await logPaymentEvent(store, actor, "payment.allocated", paymentId, {
    invoiceId: allocation.invoiceId,
  });
  await logInvoiceEvent(store, actor, "invoice.payment_allocated", allocation.invoiceId, {
    paymentId,
  });
}

/** Removes one allocation (the money becomes credit again). Lock order: payer, invoice, payment. */
export async function unallocatePayment(
  store: InvoiceStore,
  actor: Actor,
  allocationId: string,
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  if (!isUuid(allocationId)) throw new DomainError(ALLOCATION_NOT_FOUND);
  const read = async () => {
    const a = await store.paymentAllocation.findUnique({
      where: { id: allocationId },
      select: {
        id: true,
        invoiceId: true,
        paymentId: true,
        payment: { select: { payerCustomerId: true, voidedAt: true } },
      },
    });
    if (!a) throw new DomainError(ALLOCATION_NOT_FOUND);
    if (a.payment.voidedAt) throw new DomainError(INVOICE_MESSAGES.paymentVoided);
    return a;
  };
  const first = await read();
  await lockCustomer(store, first.payment.payerCustomerId);
  await lockInvoiceRows(store, [first.invoiceId]);
  await lockPaymentRow(store, first.paymentId);
  const a = await read();
  const { count } = await store.paymentAllocation.deleteMany({ where: { id: a.id } });
  if (count !== 1) throw new DomainError(ALLOCATION_NOT_FOUND);
  await logPaymentEvent(store, actor, "payment.unallocated", a.paymentId, {
    invoiceId: a.invoiceId,
  });
  await logInvoiceEvent(store, actor, "invoice.payment_unallocated", a.invoiceId, {
    paymentId: a.paymentId,
  });
}

/**
 * Voids a payment (for example a bounced EFT). Its allocation rows stay as history but stop counting, so the
 * invoices owe again. voidedAt and voidedById are set together (the payments_void_pair check). The reason is
 * kept on the payment and never written to the audit line. Lock order: payer, the allocated invoices, the payment.
 */
export async function voidPayment(
  store: InvoiceStore,
  actor: Actor,
  paymentId: string,
  reason: string,
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  const text = reasonSchema.safeParse(reason);
  if (!text.success)
    throw new DomainError(text.error.issues[0]?.message ?? "Say why in a few words.");
  if (!isUuid(paymentId)) throw new DomainError(INVOICE_MESSAGES.paymentNotFound);
  const read = async () => {
    const p = await store.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        payerCustomerId: true,
        voidedAt: true,
        allocations: { select: { invoiceId: true } },
      },
    });
    if (!p) throw new DomainError(INVOICE_MESSAGES.paymentNotFound);
    if (p.voidedAt) throw new DomainError(INVOICE_MESSAGES.paymentVoided);
    return p;
  };
  const first = await read();
  await lockCustomer(store, first.payerCustomerId);
  await lockInvoiceRows(
    store,
    first.allocations.map((a) => a.invoiceId),
  );
  await lockPaymentRow(store, paymentId);
  const p = await read();
  const { count } = await store.payment.updateMany({
    where: { id: p.id, voidedAt: null },
    data: { voidedAt: new Date(), voidReason: text.data, voidedById: actor.id },
  });
  if (count !== 1) throw new DomainError(INVOICE_MESSAGES.paymentVoided);
  await logPaymentEvent(store, actor, "payment.voided", p.id, {
    allocationCount: p.allocations.length,
  });
}

/** One payment for the staff screen. Null when there is none. */
export async function getPayment(store: InvoiceStore, actor: Actor, id: string) {
  assertRole(actor, MANAGEMENT);
  if (!isUuid(id)) return null;
  const p = await store.payment.findUnique({
    where: { id },
    select: {
      id: true,
      receivedOn: true,
      amountCents: true,
      reference: true,
      note: true,
      voidedAt: true,
      voidReason: true,
      createdAt: true,
      payer: { select: { id: true, number: true, displayName: true, anonymisedAt: true } },
      allocations: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          amountCents: true,
          invoice: {
            select: {
              id: true,
              numberYear: true,
              numberSeq: true,
              customer: { select: { id: true, displayName: true } },
            },
          },
        },
      },
    },
  });
  if (!p) return null;
  const allocatedCents = p.allocations.reduce((t, a) => t + a.amountCents, 0);
  return {
    ...p,
    receivedOn: toDateString(p.receivedOn),
    allocations: p.allocations.map((a) => ({
      id: a.id,
      amountCents: a.amountCents,
      invoiceId: a.invoice.id,
      reference: formatInvoiceReference(a.invoice),
      forName: a.invoice.customer.id !== p.payer.id ? a.invoice.customer.displayName : null,
    })),
    allocatedCents,
    // Credit on account: what is left of a payment that still counts. A voided payment leaves none.
    unallocatedCents: p.voidedAt ? 0 : Math.max(0, p.amountCents - allocatedCents),
  };
}
export type PaymentView = NonNullable<Awaited<ReturnType<typeof getPayment>>>;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const whole = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, whole));
}

/** Payments, newest received first, optionally for one payer. */
export async function listPayments(
  store: InvoiceStore,
  actor: Actor,
  query: {
    payerCustomerId?: string | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
  },
) {
  assertRole(actor, MANAGEMENT);
  const pageSize = clampInt(query.pageSize, 1, 100, 25);
  const page = clampInt(query.page, 1, 10_000, 1);
  if (
    query.payerCustomerId !== undefined &&
    query.payerCustomerId !== "" &&
    !isUuid(query.payerCustomerId)
  ) {
    return { items: [], total: 0, page, pageSize };
  }
  const where = query.payerCustomerId ? { payerCustomerId: query.payerCustomerId } : {};
  const rows = await store.payment.findMany({
    where,
    orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      receivedOn: true,
      amountCents: true,
      reference: true,
      voidedAt: true,
      payer: { select: { id: true, number: true, displayName: true } },
    },
  });
  const total = await store.payment.count({ where });
  const allocated = await allocatedByPayment(
    store,
    rows.map((r) => r.id),
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      receivedOn: toDateString(r.receivedOn),
      amountCents: r.amountCents,
      reference: r.reference,
      voided: r.voidedAt !== null,
      unallocatedCents: r.voidedAt ? 0 : Math.max(0, r.amountCents - (allocated.get(r.id) ?? 0)),
      payer: r.payer,
    })),
    total,
    page,
    pageSize,
  };
}

export type OpenInvoice = {
  id: string;
  reference: string;
  forName: string | null;
  dueDate: string;
  balanceCents: number;
};

/** Issued invoices billed to the payer that still owe money, oldest due first (the allocation form). */
export async function openInvoicesForPayer(
  store: InvoiceStore,
  actor: Actor,
  payerCustomerId: string,
): Promise<OpenInvoice[]> {
  assertRole(actor, MANAGEMENT);
  if (!isUuid(payerCustomerId)) return [];
  const payerId = payerCustomerId.toLowerCase();
  const rows = await store.invoice.findMany({
    where: { billToCustomerId: payerId, status: "ISSUED" },
    orderBy: [{ dueDate: "asc" }, { numberYear: "asc" }, { numberSeq: "asc" }],
    select: {
      id: true,
      numberYear: true,
      numberSeq: true,
      dueDate: true,
      totalCents: true,
      customer: { select: { id: true, displayName: true } },
    },
  });
  const allocated = await allocatedByInvoice(
    store,
    rows.map((r) => r.id),
  );
  return rows
    .map((r) => ({
      id: r.id,
      reference: formatInvoiceReference(r) ?? "",
      forName: r.customer.id !== payerId ? r.customer.displayName : null,
      dueDate: r.dueDate ? toDateString(r.dueDate) : "",
      balanceCents: (r.totalCents ?? 0) - (allocated.get(r.id) ?? 0),
    }))
    .filter((r) => r.balanceCents > 0);
}
