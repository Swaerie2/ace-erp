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
});
