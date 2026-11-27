import { randomInt, randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client";
import type { TxRunner } from "../portal/access";
import { fromDateString } from "../quotes/reference";

export { crew, manager, owner } from "../quotes/test-helpers";

type Tx = Prisma.TransactionClient;

/** A short unique tag for made-up names. */
export const tag = () => randomUUID().replaceAll("-", "").slice(0, 8);

/**
 * A made-up customer with one contact who receives invoices and one property, written directly (no quote
 * flow). Pass `email: null` for a contact without an email.
 */
export async function makeBillingCustomer(
  tx: Tx,
  opts: {
    status?: "LEAD" | "ACTIVE" | "PAUSED" | "ARCHIVED";
    billingTiming?: "PRE" | "POST";
    managedById?: string;
    billsToManager?: boolean;
    email?: string | null;
    name?: string;
  } = {},
) {
  const t = tag();
  const created = await tx.customer.create({
    data: {
      type: "COMPANY",
      displayName: opts.name ?? `ZZ E2E Invoice ${t}`,
      status: opts.status ?? "ACTIVE",
      billingTiming: opts.billingTiming ?? "PRE",
      billingLine1: "1 Test Road",
      billingSuburb: "Testville",
      ...(opts.status === "ARCHIVED" ? { archivedAt: new Date() } : {}),
      ...(opts.managedById
        ? { managedById: opts.managedById, billsToManager: opts.billsToManager ?? true }
        : {}),
      contacts: {
        create: [
          {
            name: `ZZ E2E Contact ${t}`,
            email: opts.email === undefined ? `zz.${t}@example.com` : opts.email,
            phone: opts.email === null ? "+27820000000" : null,
            receivesInvoices: true,
          },
        ],
      },
      properties: { create: [{ label: `Site ${t}`, addressLine1: "1 Test Road" }] },
    },
    select: {
      id: true,
      number: true,
      displayName: true,
      properties: { select: { id: true, label: true } },
    },
  });
  const property = created.properties[0];
  if (!property) throw new Error("The test property was not created.");
  return {
    customerId: created.id,
    number: created.number,
    displayName: created.displayName,
    propertyId: property.id,
    propertyLabel: property.label,
  };
}

/** A second property on a customer. */
export async function addProperty(
  tx: Tx,
  customerId: string,
  label = `Site ${tag()}`,
): Promise<string> {
  const p = await tx.property.create({
    data: { customerId, label, addressLine1: "2 Test Road" },
    select: { id: true },
  });
  return p.id;
}

export type TestQuoteLine = {
  lineKind: "PRICED" | "OPTIONAL" | "INCLUDED";
  billing: "MONTHLY" | "ONCE_OFF" | null;
  frequency: "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "AS_REQUIRED" | null;
  description: string;
  amountCents: number | null;
  chosen: boolean;
};

export const serviceLine = (
  amountCents: number,
  description = "Weekly garden maintenance",
): TestQuoteLine => ({
  lineKind: "PRICED",
  billing: "MONTHLY",
  frequency: "WEEKLY",
  description,
  amountCents,
  chosen: false,
});

export const optionalLine = (
  amountCents: number,
  chosen: boolean,
  description = "Weed treatment",
): TestQuoteLine => ({
  lineKind: "OPTIONAL",
  billing: "MONTHLY",
  frequency: "AS_REQUIRED",
  description,
  amountCents,
  chosen,
});

export const onceOffQuoteLine = (
  amountCents: number,
  description = "Once-off clean-up",
): TestQuoteLine => ({
  lineKind: "PRICED",
  billing: "ONCE_OFF",
  frequency: null,
  description,
  amountCents,
  chosen: false,
});

/**
 * An ACCEPTED quote with these lines, written straight to the database: no issue flow and no quote number
 * counter (year 2099 and a random number, so it never meets a real number).
 */
export async function makeAcceptedQuote(
  tx: Tx,
  input: {
    customerId: string;
    propertyId: string;
    /** null: no start date (the run falls back to the acceptance date). */
    startDate: string | null;
    lines: TestQuoteLine[];
    /** null: no acceptance date either (only possible on hand-edited data). */
    acceptedAt?: Date | null;
    /** Ended some other way than by a replacement (agreementEndedAt set, agreementReplacedById null). */
    agreementEnded?: boolean;
  },
) {
  const quote = await tx.quote.create({
    data: {
      customerId: input.customerId,
      propertyId: input.propertyId,
      status: "ACCEPTED",
      numberYear: 2099,
      numberSeq: randomInt(1, 2_000_000_000),
      validUntil: fromDateString("2099-12-31"),
      issuedAt: new Date(),
      acceptedAt: input.acceptedAt === undefined ? new Date() : input.acceptedAt,
      acceptedMethod: "PHONE",
      acceptedByName: "ZZ E2E Acceptor",
      acceptedStartDate: input.startDate ? fromDateString(input.startDate) : null,
      ...(input.agreementEnded ? { agreementEndedAt: new Date() } : {}),
      lines: {
        create: input.lines.map((l, index) => ({
          sortOrder: index + 1,
          lineKind: l.lineKind,
          billing: l.billing,
          frequency: l.frequency,
          description: l.description,
          amountCents: l.amountCents,
          chosen: l.chosen,
        })),
      },
    },
    select: { id: true, lines: { orderBy: { sortOrder: "asc" }, select: { id: true } } },
  });
  return { quoteId: quote.id, lineIds: quote.lines.map((l) => l.id) };
}

/** Marks `oldQuoteId` as replaced by `newQuoteId`, the way accepting a replacement monthly quote does. */
export async function replaceAgreement(
  tx: Tx,
  oldQuoteId: string,
  newQuoteId: string,
): Promise<void> {
  await tx.quote.update({
    where: { id: oldQuoteId },
    data: { agreementEndedAt: new Date(), agreementReplacedById: newQuoteId },
    select: { id: true },
  });
}

/** An ISSUED invoice written straight to the database (year 2099, a random number: no counter). */
export async function makeIssuedInvoice(
  tx: Tx,
  input: {
    customerId: string;
    billToCustomerId?: string;
    totalCents?: number;
    dueDate: string;
    issuedOn?: string;
    kind?: "MONTHLY" | "ONCE_OFF";
    serviceMonth?: string;
  },
): Promise<string> {
  const kind = input.kind ?? "ONCE_OFF";
  const total = input.totalCents ?? 100000;
  const inv = await tx.invoice.create({
    data: {
      customerId: input.customerId,
      billToCustomerId: input.billToCustomerId ?? input.customerId,
      kind,
      serviceMonth:
        kind === "MONTHLY" ? fromDateString(`${input.serviceMonth ?? "2099-01"}-01`) : null,
      status: "ISSUED",
      numberYear: 2099,
      numberSeq: randomInt(1, 2_000_000_000),
      dueDate: fromDateString(input.dueDate),
      issuedAt: input.issuedOn ? fromDateString(input.issuedOn) : new Date(),
      totalCents: total,
      recipientName: "ZZ E2E Recipient",
      recipientAddress: "1 Test Road, Testville",
      lines: {
        create: [
          {
            sortOrder: 1,
            kind: kind === "MONTHLY" ? "SERVICE" : "ONCE_OFF",
            description: "ZZ E2E work",
            amountCents: total,
          },
        ],
      },
    },
    select: { id: true },
  });
  return inv.id;
}

/** A payment written straight to the database, optionally allocated and optionally voided. */
export async function makePayment(
  tx: Tx,
  input: {
    payerCustomerId: string;
    amountCents: number;
    receivedOn: string;
    allocations?: { invoiceId: string; amountCents: number }[];
    voided?: boolean;
    reference?: string;
  },
): Promise<string> {
  const p = await tx.payment.create({
    data: {
      payerCustomerId: input.payerCustomerId,
      amountCents: input.amountCents,
      receivedOn: fromDateString(input.receivedOn),
      recordedById: randomUUID(),
      reference: input.reference ?? null,
      // payments_void_pair: voidedAt and voidedById are set together.
      ...(input.voided
        ? { voidedAt: new Date(), voidedById: randomUUID(), voidReason: "ZZ E2E test" }
        : {}),
      allocations: { create: input.allocations ?? [] },
    },
    select: { id: true },
  });
  return p.id;
}

/** Made-up bank details on the settings row (rolled back with the test). */
export async function fillBankDetails(tx: Tx): Promise<void> {
  await tx.invoiceSettings.update({
    where: { id: "singleton" },
    data: {
      bankName: "ZZ Test Bank",
      accountHolder: "ACE Garden Services",
      accountNumber: "1234567890",
      branchCode: "250655",
      accountType: "Business cheque",
    },
    select: { id: true },
  });
}

/** A runner that keeps everything inside the test's rolled-back transaction. */
export function sameTx(tx: Tx): TxRunner {
  return <T>(fn: (t: Prisma.TransactionClient) => Promise<T>) => fn(tx);
}

/**
 * The audit lines written about one record, sorted by `at`. Rows written in one transaction can share the same
 * `at`, so the order among them is not reliable: callers must not depend on it (filter, count or use
 * `toContainEqual` instead).
 */
export function auditFor(tx: Tx, entityType: string, entityId: string) {
  return tx.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { at: "asc" },
    select: { action: true, after: true, actorId: true },
  });
}
