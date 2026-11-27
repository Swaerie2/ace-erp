import { recordAudit, staffParty } from "../audit";
import { DomainError, type Actor } from "../customers/access";
import { lockCustomer } from "../customers/store";
import type { Db } from "../db";
import type { Prisma } from "../generated/prisma/client";

/** What the invoice functions need. Works with the normal connection or a transaction. */
export type InvoiceStore = Pick<
  Db,
  | "invoice"
  | "invoiceLine"
  | "invoiceSettings"
  | "invoiceCounter"
  | "payment"
  | "paymentAllocation"
  | "paymentReport"
  | "customer"
  | "contact"
  | "property"
  | "quote"
  | "quoteLine"
  | "quoteWording"
  | "organisationSettings"
  | "auditLog"
  | "staffUser"
  | "$queryRaw"
>;

/** Messages the app compares against (to choose a fixed notice code) as well as shows. */
export const INVOICE_MESSAGES = {
  notFound: "That invoice could not be found.",
  paymentNotFound: "That payment could not be found.",
  reportNotFound: "That payment report could not be found.",
  onlyDraftChange: "Only a draft can be changed.",
  onlyDraftIssue: "Only a draft can be issued.",
  onlyDraftDelete: "Only a draft can be deleted.",
  onlyIssuedVoid: "Only an issued invoice can be voided. Delete a draft instead.",
  onlyIssuedEmail: "Only an issued invoice can be emailed.",
  hasAllocations:
    "This invoice has payments allocated to it. Remove the allocations or void the payments first.",
  billingChanged: "The customer's billing changed while this was being done. Try again.",
  bankMissing: "Enter ACE's bank details in Invoice settings before issuing.",
  archived: "Restore this customer before invoicing.",
  anonymised: "This customer has been anonymised and cannot be invoiced.",
  billToInactive:
    "The customer this invoice is billed to is archived or anonymised. Restore it, or change who the bills go to, before issuing.",
  paymentVoided: "This payment has been voided.",
  notPayersInvoice: "That invoice is not billed to this payer.",
  notIssued: "Payments can only be allocated to issued invoices.",
  overBalance: "That is more than the invoice still owes.",
  overPayment: "That is more than is left of the payment.",
  duplicateInvoice: "Each invoice can be listed only once.",
  reportResolved: "This report has already been dealt with.",
  quoteInvoiced: "This quote has already been invoiced.",
  quoteNotAccepted: "Only an accepted quote of this customer can be invoiced.",
  quoteNoOnceOff: "That quote has no accepted once-off work to invoice.",
  runMonth: "Choose a month from a year ago up to next month.",
} as const;

/** Two people saved the same draft; the later one must reload instead of overwriting. */
export class InvoiceDraftConflictError extends DomainError {
  constructor() {
    super("This invoice was changed somewhere else. Reload the page to see the latest version.");
    this.name = "InvoiceDraftConflictError";
  }
}

/** A draft that cannot be issued yet. `problems` are plain sentences; the message joins them. */
export class InvoiceIssueError extends DomainError {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join("\n"));
    this.name = "InvoiceIssueError";
    this.problems = problems;
  }
}

async function logEvent(
  store: Pick<Db, "auditLog">,
  actor: Actor,
  entityType: string,
  action: string,
  entityId: string,
  after?: Prisma.InputJsonValue,
): Promise<void> {
  const party = staffParty(actor);
  await recordAudit(store, {
    actorType: party.actorType,
    actorId: actor.id,
    action,
    entityType,
    entityId,
    ...(after !== undefined ? { after } : {}),
    ...(party.ip ? { ip: party.ip } : {}),
    ...(party.userAgent ? { userAgent: party.userAgent } : {}),
  });
}

/** An audit line about an invoice. `after` holds field names, ids, counts and fixed words only. */
export function logInvoiceEvent(
  store: Pick<Db, "auditLog">,
  actor: Actor,
  action: string,
  invoiceId: string,
  after?: Prisma.InputJsonValue,
): Promise<void> {
  return logEvent(store, actor, "invoice", action, invoiceId, after);
}

/** An audit line about a payment. `after` holds field names, ids, counts and fixed words only. */
export function logPaymentEvent(
  store: Pick<Db, "auditLog">,
  actor: Actor,
  action: string,
  paymentId: string,
  after?: Prisma.InputJsonValue,
): Promise<void> {
  return logEvent(store, actor, "payment", action, paymentId, after);
}

/**
 * Lock order everywhere: customers (smaller id first), then invoices (smaller id first), then payments, then
 * payment reports. Ids are lowercased first, so an uppercase UUID neither escapes de-duplication nor sorts
 * differently from the same id in lowercase.
 */
export const sortedUniqueIds = (ids: readonly string[]): string[] =>
  [...new Set(ids.map((id) => id.toLowerCase()))].sort();

/** Locks several customers, smaller id first (the lock order used everywhere). */
export async function lockCustomersInOrder(
  store: Pick<Db, "customer">,
  ids: readonly string[],
): Promise<void> {
  for (const id of sortedUniqueIds(ids)) await lockCustomer(store, id);
}

/** Locks invoice rows until the transaction ends, smaller id first. */
export async function lockInvoiceRows(
  store: Pick<Db, "$queryRaw">,
  ids: readonly string[],
): Promise<void> {
  for (const id of sortedUniqueIds(ids)) {
    const rows = await store.$queryRaw<{ id: string }[]>`
      select "id" from "invoices" where "id" = ${id}::uuid for update`;
    if (rows.length !== 1) throw new DomainError(INVOICE_MESSAGES.notFound);
  }
}

/** Locks one payment row until the transaction ends. Payments come after customers and invoices in the lock order. */
export async function lockPaymentRow(store: Pick<Db, "$queryRaw">, id: string): Promise<void> {
  const rows = await store.$queryRaw<{ id: string }[]>`
    select "id" from "payments" where "id" = ${id}::uuid for update`;
  if (rows.length !== 1) throw new DomainError(INVOICE_MESSAGES.paymentNotFound);
}

/**
 * Locks one payment report row until the transaction ends. Reports come LAST in the lock order: after the
 * customers, the invoices and the payment (so confirming a report while recording its payment cannot deadlock).
 */
export async function lockReportRow(store: Pick<Db, "$queryRaw">, id: string): Promise<void> {
  const rows = await store.$queryRaw<{ id: string }[]>`
    select "id" from "payment_reports" where "id" = ${id}::uuid for update`;
  if (rows.length !== 1) throw new DomainError(INVOICE_MESSAGES.reportNotFound);
}

/** The money allocated to each invoice from payments that are not voided. Missing ids mean 0. */
export async function allocatedByInvoice(
  store: Pick<Db, "paymentAllocation">,
  invoiceIds: readonly string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (invoiceIds.length === 0) return map;
  const rows = await store.paymentAllocation.findMany({
    where: { invoiceId: { in: [...new Set(invoiceIds)] }, payment: { voidedAt: null } },
    select: { invoiceId: true, amountCents: true },
  });
  for (const r of rows) map.set(r.invoiceId, (map.get(r.invoiceId) ?? 0) + r.amountCents);
  return map;
}

/** The money already allocated from each payment. Missing ids mean 0. */
export async function allocatedByPayment(
  store: Pick<Db, "paymentAllocation">,
  paymentIds: readonly string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (paymentIds.length === 0) return map;
  const rows = await store.paymentAllocation.findMany({
    where: { paymentId: { in: [...new Set(paymentIds)] } },
    select: { paymentId: true, amountCents: true },
  });
  for (const r of rows) map.set(r.paymentId, (map.get(r.paymentId) ?? 0) + r.amountCents);
  return map;
}

/** Who pays: the managing agency when "Bills go to" the agency is on, else the customer itself. */
export function billToIdFor(c: {
  id: string;
  managedById: string | null;
  billsToManager: boolean;
}): string {
  return c.managedById && c.billsToManager ? c.managedById : c.id;
}

const MONTHLY_INDEX = "invoices_monthly_once_per_month";

type DbErrorShape = {
  code?: unknown;
  message?: unknown;
  /** Set on a raw node-postgres error. */
  constraint?: unknown;
  meta?: {
    target?: unknown;
    driverAdapterError?: {
      cause?: {
        originalCode?: unknown;
        originalMessage?: unknown;
        constraint?: { index?: unknown; fields?: unknown };
      };
    };
  };
};

const mentions = (value: unknown, word: string): boolean =>
  Array.isArray(value)
    ? value.some((v) => mentions(v, word))
    : typeof value === "string" && value.includes(word);

/**
 * True only when the database refused a second live monthly invoice for the same customer and month (the
 * partial unique index `invoices_monthly_once_per_month`). Any other unique error (an invoice number, an
 * allocation pair) gives false. Use it only around creating a MONTHLY DRAFT, and put the catch OUTSIDE the
 * interactive transaction: after a unique violation (23505) Postgres has aborted that transaction, so the only
 * safe reaction is to let it roll back and then report the customer as skipped.
 */
export function isMonthlyDuplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as DbErrorShape;
  const meta = typeof e.meta === "object" && e.meta !== null ? e.meta : {};
  const cause = meta.driverAdapterError?.cause;
  const namesIndex = [
    e.message,
    e.constraint,
    cause?.originalMessage,
    cause?.constraint?.index,
  ].some((v) => mentions(v, MONTHLY_INDEX));
  if (e.code === "P2002") {
    const target = meta.target;
    const targetIsMonth = Array.isArray(target)
      ? target.includes("serviceMonth")
      : target === "serviceMonth";
    return namesIndex || mentions(target, MONTHLY_INDEX) || targetIsMonth;
  }
  // Raw Postgres errors (node-postgres code 23505, or Prisma's raw-query P2010 wrapping one).
  const raw = e.code === "23505" || cause?.originalCode === "23505";
  return raw && namesIndex;
}
