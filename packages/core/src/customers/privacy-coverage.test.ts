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
  agreedMonthlyFeeCents: "kept: money, old invoices must still add up",
  extrasNote: "scrubbed",
  archivedAt: "kept: timestamp",
  createdAt: "kept: timestamp",
  updatedAt: "kept: timestamp",
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
});
