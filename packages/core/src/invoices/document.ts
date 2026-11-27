import { z } from "zod";
import { assertRole, DomainError, MANAGEMENT, type Actor } from "../customers/access";
import { formatCustomerNumber } from "../customers/number";
import { readCompanyLogoVersion } from "../company/profile";
import { formatZAR } from "../money";
import { addDays, formatDateSA, fromDateString, toDateString, todaySA } from "../quotes/reference";
import { formatMonthLabel } from "./dates";
import {
  INVOICE_LINE_KIND_LABELS,
  INVOICE_STATUS_LABELS,
  NOT_VAT_REGISTERED,
  type InvoiceDisplayStatus,
  type InvoiceLineKindValue,
} from "./labels";
import { formatBillingAddress, invoiceDisplayStatus, sumLineCents } from "./money";
import { formatInvoiceReference } from "./reference";
import { bankDetailsReady, invoiceSnapshotSchema, type InvoiceSnapshot } from "./schemas";
import { buildInvoiceSnapshot, readInvoiceSettings } from "./settings";
import type { StatementData } from "./statement-math";
import { getStatement } from "./statements";
import { billToIdFor, type InvoiceStore } from "./store";

/** Ids from the app are checked before they reach a uuid column (a bad one would make Postgres refuse). */
const isUuid = (value: string) => z.uuid().safeParse(value).success;

/** "2026-11-20" -> "20 Nov 2026" in South African style. */
const day = (date: string): string => formatDateSA(fromDateString(date));

export type InvoiceDocumentInput = {
  reference: string | null;
  status: InvoiceDisplayStatus;
  kind: "MONTHLY" | "ONCE_OFF";
  issuedOn: string | null;
  dueOn: string | null;
  serviceMonth: string | null;
  billTo: { name: string; address: string | null };
  forCustomerName: string | null;
  lines: { id: string; kind: InvoiceLineKindValue; description: string; amountCents: number }[];
  paidCents: number;
  snapshot: InvoiceSnapshot;
  /** The logo's cache buster (see readCompanyLogoVersion); null or left out when there is no logo. */
  logoVersion?: string | null;
};

/** ACE's details on a document. `address` is null when none was entered (or frozen). */
export type DocumentBusiness = Omit<InvoiceSnapshot["business"], "address"> & {
  address: string | null;
};

const businessOf = (snapshot: InvoiceSnapshot): DocumentBusiness => ({
  ...snapshot.business,
  address: snapshot.business.address ?? null,
});

export type InvoiceDocument = {
  reference: string;
  status: InvoiceDisplayStatus;
  statusLabel: string;
  banner: string | null;
  title: string;
  issuedDate: string | null;
  dueDate: string | null;
  serviceMonthLabel: string | null;
  billTo: { name: string; address: string | null };
  forCustomerName: string | null;
  business: DocumentBusiness;
  /** The logo's cache buster: the apps build the logo URL from it. Null when there is no logo. */
  logoVersion: string | null;
  rows: { id: string; description: string; kindLabel: string; amountLabel: string }[];
  totalLabel: string;
  paidLabel: string | null;
  balanceLabel: string | null;
  bank: InvoiceSnapshot["bank"];
  bankReady: boolean;
  paymentReference: string;
  vatNote: string;
};

const BANNERS: Partial<Record<InvoiceDisplayStatus, string>> = {
  DRAFT: "Draft: not yet issued.",
  VOID: "This invoice has been voided. Nothing is owed on it.",
  OVERDUE: "This invoice is overdue.",
  PAID: "Paid in full. Thank you.",
};

/** Everything the screen and the PDF show, as plain data. No layout decisions live here. */
export function buildInvoiceDocument(input: InvoiceDocumentInput): InvoiceDocument {
  const total = sumLineCents(input.lines);
  const owing = input.status !== "DRAFT" && input.status !== "VOID";
  return {
    reference: input.reference ?? "Draft",
    status: input.status,
    statusLabel: INVOICE_STATUS_LABELS[input.status],
    banner: BANNERS[input.status] ?? null,
    title: input.kind === "MONTHLY" ? "Monthly invoice" : "Invoice",
    issuedDate: input.issuedOn ? day(input.issuedOn) : null,
    dueDate: input.dueOn ? day(input.dueOn) : null,
    serviceMonthLabel: input.serviceMonth ? formatMonthLabel(input.serviceMonth) : null,
    billTo: input.billTo,
    forCustomerName: input.forCustomerName,
    business: businessOf(input.snapshot),
    logoVersion: input.logoVersion ?? null,
    rows: input.lines.map((l) => ({
      id: l.id,
      description: l.description,
      kindLabel: INVOICE_LINE_KIND_LABELS[l.kind],
      amountLabel: formatZAR(l.amountCents),
    })),
    totalLabel: formatZAR(total),
    paidLabel: owing && input.paidCents > 0 ? formatZAR(input.paidCents) : null,
    balanceLabel:
      owing && input.paidCents > 0 ? formatZAR(Math.max(0, total - input.paidCents)) : null,
    bank: input.snapshot.bank,
    bankReady: bankDetailsReady(input.snapshot.bank),
    paymentReference: input.snapshot.paymentReference,
    vatNote: NOT_VAT_REGISTERED,
  };
}

/**
 * The document of a stored invoice. Owner or manager. An issued or void invoice uses its frozen recipient and
 * snapshot (never the live settings); a draft is built from the live bill-to customer and settings, with an
 * empty due date shown as today plus the once-off due days. Null when the id is malformed or unknown.
 */
export async function loadInvoiceDocument(
  store: InvoiceStore,
  actor: Actor,
  id: string,
): Promise<{ doc: InvoiceDocument } | null> {
  assertRole(actor, MANAGEMENT);
  if (!isUuid(id)) return null;
  const inv = await store.invoice.findUnique({
    where: { id: id.toLowerCase() },
    select: {
      id: true,
      status: true,
      kind: true,
      numberYear: true,
      numberSeq: true,
      issuedAt: true,
      dueDate: true,
      serviceMonth: true,
      totalCents: true,
      recipientName: true,
      recipientAddress: true,
      bankSnapshot: true,
      billToCustomerId: true,
      customer: {
        select: { id: true, displayName: true, managedById: true, billsToManager: true },
      },
      lines: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, kind: true, description: true, amountCents: true },
      },
      allocations: { where: { payment: { voidedAt: null } }, select: { amountCents: true } },
    },
  });
  if (!inv) return null;

  const today = todaySA();
  const paidCents = inv.allocations.reduce((t, a) => t + a.amountCents, 0);
  const frozen = inv.status !== "DRAFT";
  const billToId = frozen ? inv.billToCustomerId : billToIdFor(inv.customer);
  const dueDate = inv.dueDate ? toDateString(inv.dueDate) : null;

  let snapshot: InvoiceSnapshot;
  let billTo: { name: string; address: string | null };
  let dueOn = dueDate;
  if (frozen) {
    const parsed = invoiceSnapshotSchema.safeParse(inv.bankSnapshot);
    if (!parsed.success) {
      throw new DomainError(
        "This invoice is missing its saved business details, so it cannot be shown. Please tell support.",
      );
    }
    snapshot = parsed.data;
    billTo = { name: inv.recipientName ?? "Anonymised customer", address: inv.recipientAddress };
  } else {
    const settings = await readInvoiceSettings(store);
    const live = await store.customer.findUnique({
      where: { id: billToId },
      select: {
        number: true,
        displayName: true,
        billingLine1: true,
        billingLine2: true,
        billingSuburb: true,
        billingCity: true,
        billingPostalCode: true,
      },
    });
    if (!live) return null;
    snapshot = await buildInvoiceSnapshot(store, settings, live.number);
    billTo = { name: live.displayName, address: formatBillingAddress(live) };
    dueOn ??= addDays(today, settings.onceOffDueDays);
  }

  const totalCents = inv.totalCents ?? sumLineCents(inv.lines);
  const doc = buildInvoiceDocument({
    reference: formatInvoiceReference(inv),
    status: invoiceDisplayStatus(
      { status: inv.status, totalCents, allocatedCents: paidCents, dueDate },
      today,
    ),
    kind: inv.kind,
    issuedOn: inv.issuedAt ? todaySA(inv.issuedAt) : null,
    dueOn,
    serviceMonth: inv.serviceMonth ? toDateString(inv.serviceMonth).slice(0, 7) : null,
    billTo,
    forCustomerName: billToId !== inv.customer.id ? inv.customer.displayName : null,
    lines: inv.lines,
    paidCents,
    snapshot,
    logoVersion: await readCompanyLogoVersion(store),
  });
  return { doc };
}

export type StatementDocument = {
  periodLabel: string;
  generatedDate: string;
  customer: { name: string; number: string; address: string | null };
  business: DocumentBusiness;
  /** The logo's cache buster: the apps build the logo URL from it. Null when there is no logo. */
  logoVersion: string | null;
  bank: InvoiceSnapshot["bank"];
  bankReady: boolean;
  paymentReference: string;
  summary: {
    opening: string;
    invoiced: string;
    paid: string;
    closing: string;
    closingNote: string;
    credit: string | null;
  };
  rows: {
    key: string;
    date: string;
    description: string;
    forName: string | null;
    debit: string;
    credit: string;
    balance: string;
  }[];
  outstanding: {
    id: string;
    reference: string;
    forName: string | null;
    dueDate: string;
    balance: string;
    overdue: boolean;
  }[];
  byComplex: { name: string; invoiced: string; outstanding: string }[];
  vatNote: string;
};

/** "Payment received, ref X" becomes "Payment received, ref X (applied to INV-2026-0001, INV-2026-0002)". */
function entryDescription(e: StatementData["entries"][number]): string {
  const references = e.allocations.map((a) => a.reference).filter((r) => r !== "");
  return references.length > 0 ? `${e.label} (applied to ${references.join(", ")})` : e.label;
}

export function buildStatementDocument(input: {
  data: StatementData;
  customer: { name: string; number: number; address: string | null };
  snapshot: InvoiceSnapshot;
  generatedOn: string;
  logoVersion?: string | null;
}): StatementDocument {
  const d = input.data;
  return {
    periodLabel: `${day(d.from)} to ${day(d.to)}`,
    generatedDate: day(input.generatedOn),
    customer: {
      name: input.customer.name,
      number: formatCustomerNumber(input.customer.number),
      address: input.customer.address,
    },
    business: businessOf(input.snapshot),
    logoVersion: input.logoVersion ?? null,
    bank: input.snapshot.bank,
    bankReady: bankDetailsReady(input.snapshot.bank),
    paymentReference: input.snapshot.paymentReference,
    summary: {
      opening: formatZAR(d.openingCents),
      invoiced: formatZAR(d.invoicedCents),
      paid: formatZAR(d.paidCents),
      closing: formatZAR(Math.abs(d.closingCents)),
      closingNote:
        d.closingCents > 0 ? "Amount due" : d.closingCents < 0 ? "In credit" : "Nothing owed",
      credit: d.creditCents > 0 ? formatZAR(d.creditCents) : null,
    },
    rows: d.entries.map((e) => ({
      key: `${e.kind}-${e.id}`,
      date: day(e.date),
      description: entryDescription(e),
      forName: e.customerName,
      debit: e.debitCents > 0 ? formatZAR(e.debitCents) : "",
      credit: e.creditCents > 0 ? formatZAR(e.creditCents) : "",
      balance: formatZAR(e.balanceCents),
    })),
    outstanding: d.outstanding.map((o) => ({
      id: o.id,
      reference: o.reference,
      forName: o.customerName,
      dueDate: day(o.dueOn),
      balance: formatZAR(o.balanceCents),
      overdue: o.overdue,
    })),
    byComplex: d.byComplex.map((c) => ({
      name: c.customerName,
      invoiced: formatZAR(c.invoicedCents),
      outstanding: formatZAR(c.outstandingCents),
    })),
    vatNote: NOT_VAT_REGISTERED,
  };
}

/**
 * The statement with its document, using ACE's current details (statements are made on demand, not frozen).
 * Owner or manager. Null for a malformed or unknown customer id; a bad period throws a DomainError.
 */
export async function loadStatementDocument(
  store: InvoiceStore,
  actor: Actor,
  customerId: string,
  period: { from: string; to: string },
) {
  assertRole(actor, MANAGEMENT);
  const statement = await getStatement(store, actor, customerId, period);
  if (!statement) return null;
  const settings = await readInvoiceSettings(store);
  const snapshot = await buildInvoiceSnapshot(store, settings, statement.customer.number);
  return {
    ...statement,
    doc: buildStatementDocument({
      data: statement.data,
      customer: {
        name: statement.customer.displayName,
        number: statement.customer.number,
        address: statement.customer.address,
      },
      snapshot,
      generatedOn: todaySA(),
      logoVersion: await readCompanyLogoVersion(store),
    }),
  };
}
