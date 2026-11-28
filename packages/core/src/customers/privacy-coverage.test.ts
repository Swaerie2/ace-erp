import { describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";

/**
 * POPIA guard. Every column on the customer, contact and property tables must be classified here
 * as either wiped by `anonymiseCustomer` ("scrubbed") or deliberately left alone ("kept", with the
 * reason). Adding a column to the schema makes this test fail until someone decides which it is,
 * and, for "scrubbed", updates `anonymiseCustomer` (privacy.db.test.ts then proves it is gone).
 */
type Rule = "scrubbed" | `kept: ${string}`;

const CUSTOMER: Record<string, Rule> = {
  id: "kept: identifier",
  number: "kept: customer number, needed so old invoices still match",
  type: "kept: enum (person or company)",
  displayName: "scrubbed",
  companyName: "scrubbed",
  registrationNumber: "scrubbed",
  status: "kept: enum, set to ARCHIVED by the scrub",
  statusBeforeArchive: "scrubbed",
  billingLine1: "scrubbed",
  billingLine2: "scrubbed",
  billingSuburb: "scrubbed",
  billingCity: "scrubbed",
  billingPostalCode: "scrubbed",
  source: "kept: enum (referral, google...), not personal",
  sourceNote: "scrubbed",
  notes: "scrubbed",
  consentAt: "scrubbed",
  consentSource: "scrubbed",
  consentNote: "scrubbed",
  managedById: "scrubbed",
  billsToManager: "kept: yes/no setting, who bills go to",
  billingTiming: "kept: enum (pre or post billing), not personal",
  archivedAt: "kept: timestamp",
  anonymisedAt: "kept: timestamp, set by the scrub itself",
  createdById: "kept: staff id, not about the customer",
  createdAt: "kept: timestamp",
  updatedAt: "kept: timestamp",
};

const CONTACT: Record<string, Rule> = {
  id: "kept: identifier",
  customerId: "kept: identifier",
  name: "scrubbed",
  role: "scrubbed",
  email: "scrubbed",
  phone: "scrubbed",
  receivesQuotes: "kept: yes/no setting",
  receivesInvoices: "kept: yes/no setting",
  portalAccess: "scrubbed",
  portalInvitedAt: "scrubbed",
  portalWelcomedAt: "scrubbed",
  lastSignedInAt: "scrubbed",
  createdAt: "kept: timestamp",
  updatedAt: "kept: timestamp",
};

const PROPERTY: Record<string, Rule> = {
  id: "kept: identifier",
  customerId: "kept: identifier",
  label: "scrubbed",
  addressLine1: "scrubbed",
  addressLine2: "scrubbed",
  suburb: "scrubbed",
  city: "scrubbed",
  postalCode: "scrubbed",
  mapUrl: "scrubbed",
  accessNotes: "scrubbed",
  lawnSizeSqm: "kept: a measurement, not personal once the address is gone",
  grassType: "scrubbed",
  hasIrrigation: "kept: yes/no fact about the lawn",
  terrainNotes: "scrubbed",
  frequency: "kept: enum (weekly, monthly...)",
  preferredDay: "kept: day of the week, not personal",
  archivedAt: "kept: timestamp",
  createdAt: "kept: timestamp",
  updatedAt: "kept: timestamp",
};

const QUOTE: Record<string, Rule> = {
  id: "kept: identifier",
  customerId: "kept: identifier",
  propertyId: "kept: identifier",
  status: "kept: enum, not personal",
  numberYear: "kept: part of the quote reference",
  numberSeq: "kept: part of the quote reference",
  revision: "kept: whole number",
  revisionOfId: "kept: identifier",
  draftVersion: "kept: whole number",
  validUntil: "kept: date the quote was valid until",
  internalNote: "scrubbed",
  createdById: "kept: staff id, not about the customer",
  createdAt: "kept: timestamp",
  updatedAt: "kept: timestamp",
  issuedAt: "kept: timestamp",
  issuedById: "kept: staff id, not about the customer",
  sentAt: "kept: timestamp",
  sentMethod: "kept: enum (whatsapp, email...)",
  recipientName: "scrubbed",
  recipientEmail: "scrubbed",
  recipientPhone: "scrubbed",
  siteLabel: "scrubbed",
  siteAddress: "scrubbed",
  wordingSnapshot: "kept: ACE's own standard wording, no customer details",
  contentHash: "kept: fingerprint, cannot be turned back into the content",
  acceptedAt: "kept: timestamp",
  acceptedMethod: "kept: enum (whatsapp, phone...)",
  acceptedByName: "scrubbed",
  acceptedStartDate: "kept: date the service started",
  acceptanceNote: "scrubbed",
  acceptedByStaffId: "kept: staff id, not about the customer",
  acceptedIp: "scrubbed",
  acceptedUserAgent: "scrubbed",
  declinedAt: "kept: timestamp",
  declineReason: "scrubbed",
  withdrawnAt: "kept: timestamp",
  reversedAt: "kept: timestamp",
  reversalNote: "scrubbed",
  agreementEndedAt: "kept: timestamp",
  agreementReplacedById: "kept: identifier",
  linkToken: "scrubbed",
  linkCreatedAt: "kept: timestamp",
  firstViewedAt: "kept: timestamp",
  lastViewedAt: "kept: timestamp",
  declinedByClient: "kept: yes/no, who declined",
  acceptedByContactId: "kept: identifier (the contact row itself is scrubbed)",
};

const QUOTE_SCOPE_ITEM: Record<string, Rule> = {
  id: "kept: identifier",
  quoteId: "kept: identifier",
  serviceId: "kept: identifier",
  sortOrder: "kept: whole number",
  included: "kept: yes/no setting",
  name: "kept: service name from the catalogue, not personal",
  description: "kept: service wording from the catalogue, not personal",
  kind: "kept: enum (core or optional extra)",
};

const QUOTE_LINE: Record<string, Rule> = {
  id: "kept: identifier",
  quoteId: "kept: identifier",
  sortOrder: "kept: whole number",
  lineKind: "kept: enum, not personal",
  billing: "kept: enum (monthly or once-off)",
  frequency: "kept: enum (weekly...)",
  description: "kept: price line wording written by staff, no personal details by design",
  amountCents: "kept: money, old invoices must still add up",
  chosen: "kept: yes/no, which add-on the client took",
};

// Sign-in rows are deleted outright (not scrubbed in place) when access is removed or the customer is
// anonymised; "scrubbed" here means the email goes with the row.
const PORTAL_CODE: Record<string, Rule> = {
  id: "kept: identifier",
  email: "scrubbed",
  codeHash: "kept: one-way hash of a short-lived code, deleted with the row",
  salt: "kept: random salt, not personal",
  expiresAt: "kept: timestamp",
  attempts: "kept: whole number",
  usedAt: "kept: timestamp",
  createdAt: "kept: timestamp",
};

const PORTAL_SESSION: Record<string, Rule> = {
  id: "kept: identifier",
  tokenHash: "kept: one-way hash of a random value, deleted with the row",
  email: "scrubbed",
  createdAt: "kept: timestamp",
  lastSeenAt: "kept: timestamp",
  expiresAt: "kept: timestamp",
  absoluteExpiresAt: "kept: timestamp",
};

// Module 5. Financial records are kept on anonymise (numbers, dates, amounts, allocations); the frozen
// recipient, typed references, notes and reasons are scrubbed, and line wording is replaced by a fixed word.
const INVOICE: Record<string, Rule> = {
  id: "kept: identifier",
  customerId: "kept: identifier",
  billToCustomerId: "kept: identifier",
  kind: "kept: enum (monthly or once-off)",
  serviceMonth: "kept: month the service was for",
  status: "kept: enum, not personal",
  numberYear: "kept: part of the invoice number",
  numberSeq: "kept: part of the invoice number",
  dueDate: "kept: date the invoice was due",
  issuedAt: "kept: timestamp",
  issuedById: "kept: staff id, not about the customer",
  createdAt: "kept: timestamp",
  createdById: "kept: staff id, not about the customer",
  draftVersion: "kept: whole number",
  sourceQuoteId: "kept: identifier",
  totalCents: "kept: money, the accounts must still add up",
  recipientName: "scrubbed",
  recipientAddress: "scrubbed",
  bankSnapshot: "kept: ACE's own bank and business details, nothing about the customer",
  contentHash: "kept: fingerprint, cannot be turned back into the content",
  emailStatus: "kept: enum (none, sent, failed)",
  emailedAt: "kept: timestamp",
  voidedAt: "kept: timestamp",
  voidReason: "scrubbed",
  voidedById: "kept: staff id, not about the customer",
};

const INVOICE_LINE: Record<string, Rule> = {
  id: "kept: identifier",
  invoiceId: "kept: identifier",
  sortOrder: "kept: whole number",
  propertyId: "kept: identifier (the property row itself is scrubbed)",
  kind: "kept: enum (service, late fee...)",
  description: "scrubbed",
  amountCents: "kept: money, the accounts must still add up",
  sourceQuoteLineId: "kept: identifier",
  forInvoiceId: "kept: identifier",
};

const PAYMENT: Record<string, Rule> = {
  id: "kept: identifier",
  payerCustomerId: "kept: identifier",
  receivedOn: "kept: date the money arrived",
  amountCents: "kept: money, the accounts must still add up",
  reference: "scrubbed",
  note: "scrubbed",
  recordedById: "kept: staff id, not about the customer",
  createdAt: "kept: timestamp",
  voidedAt: "kept: timestamp",
  voidReason: "scrubbed",
  voidedById: "kept: staff id, not about the customer",
};

const PAYMENT_ALLOCATION: Record<string, Rule> = {
  id: "kept: identifier",
  paymentId: "kept: identifier",
  invoiceId: "kept: identifier",
  amountCents: "kept: money, the accounts must still add up",
};

const PAYMENT_REPORT: Record<string, Rule> = {
  id: "kept: identifier",
  invoiceId: "kept: identifier",
  reportedByContactId: "kept: identifier (the contact row itself is scrubbed)",
  paidOn: "kept: date the client said they paid",
  reference: "scrubbed",
  status: "kept: enum (waiting, confirmed, dismissed)",
  createdAt: "kept: timestamp",
  resolvedAt: "kept: timestamp",
  resolvedById: "kept: staff id, not about the customer",
};

// ACE's own settings and counters: nothing about any customer.
const INVOICE_SETTINGS: Record<string, Rule> = {
  id: "kept: fixed singleton key",
  bankName: "kept: ACE's own bank details",
  accountHolder: "kept: ACE's own bank details",
  accountNumber: "kept: ACE's own bank details",
  branchCode: "kept: ACE's own bank details",
  accountType: "kept: ACE's own bank details",
  onceOffDueDays: "kept: whole number setting",
  lateFeeCents: "kept: money setting",
  updatedAt: "kept: timestamp",
  updatedById: "kept: staff id, not about the customer",
};

const INVOICE_COUNTER: Record<string, Rule> = {
  year: "kept: year number",
  lastSeq: "kept: whole number",
};

// The company logo: ACE's own image, nothing about any customer.
const COMPANY_LOGO: Record<string, Rule> = {
  id: "kept: fixed singleton key",
  data: "kept: ACE's own logo image, nothing about any customer",
  contentType: "kept: image type (png or jpeg)",
  byteSize: "kept: whole number, size of the image",
  updatedAt: "kept: timestamp",
  updatedById: "kept: staff id, not about the customer",
};

function check(name: string, columns: Record<string, string>, table: Record<string, Rule>) {
  describe(name, () => {
    const actual = Object.values(columns).sort();
    it("classifies every column in the schema (add new columns to the table above)", () => {
      expect(Object.keys(table).sort()).toEqual(actual);
    });
    it("gives every kept column a reason", () => {
      for (const [column, rule] of Object.entries(table)) {
        expect(rule === "scrubbed" || /^kept: .{5,}/.test(rule), column).toBe(true);
      }
    });
  });
}

describe("personal data coverage", () => {
  check("customers", Prisma.CustomerScalarFieldEnum, CUSTOMER);
  check("contacts", Prisma.ContactScalarFieldEnum, CONTACT);
  check("properties", Prisma.PropertyScalarFieldEnum, PROPERTY);
  check("quotes", Prisma.QuoteScalarFieldEnum, QUOTE);
  check("quote scope items", Prisma.QuoteScopeItemScalarFieldEnum, QUOTE_SCOPE_ITEM);
  check("quote lines", Prisma.QuoteLineScalarFieldEnum, QUOTE_LINE);
  check("portal codes", Prisma.PortalCodeScalarFieldEnum, PORTAL_CODE);
  check("portal sessions", Prisma.PortalSessionScalarFieldEnum, PORTAL_SESSION);
  check("invoices", Prisma.InvoiceScalarFieldEnum, INVOICE);
  check("invoice lines", Prisma.InvoiceLineScalarFieldEnum, INVOICE_LINE);
  check("payments", Prisma.PaymentScalarFieldEnum, PAYMENT);
  check("payment allocations", Prisma.PaymentAllocationScalarFieldEnum, PAYMENT_ALLOCATION);
  check("payment reports", Prisma.PaymentReportScalarFieldEnum, PAYMENT_REPORT);
  check("invoice settings", Prisma.InvoiceSettingsScalarFieldEnum, INVOICE_SETTINGS);
  check("invoice counters", Prisma.InvoiceCounterScalarFieldEnum, INVOICE_COUNTER);
  check("company logo", Prisma.CompanyLogoScalarFieldEnum, COMPANY_LOGO);
});
