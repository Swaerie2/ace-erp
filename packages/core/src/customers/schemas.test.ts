import { describe, expect, it } from "vitest";
import {
  contactSchema,
  customerSchema,
  formatCentsForInput,
  parseRandToCents,
  propertySchema,
} from "./schemas";

describe("parseRandToCents", () => {
  it.each([
    ["850", 85000],
    ["R 850.50", 85050],
    ["1,250.50", 125050],
    ["R 1 250,50", 125050],
    ["0", 0],
  ])("reads %s", (input, cents) => expect(parseRandToCents(input)).toBe(cents));

  it.each(["", "abc", "-5", "12.345", "1.2.3"])("rejects %s", (input) =>
    expect(parseRandToCents(input)).toBeNull(),
  );

  it("formats cents for an edit box", () => {
    expect(formatCentsForInput(85000)).toBe("850.00");
    expect(formatCentsForInput(125050)).toBe("1250.50");
  });
});

describe("customerSchema", () => {
  it("accepts the minimum and applies defaults", () => {
    const c = customerSchema.parse({ type: "PERSON", displayName: "  Jane Doe " });
    expect(c.displayName).toBe("Jane Doe");
    expect(c.status).toBe("ACTIVE");
    expect(c.consentGiven).toBe(false);
    expect(c.notes).toBeUndefined();
  });
  it("turns blank optional boxes into undefined and checkbox 'on' into true", () => {
    const c = customerSchema.parse({
      type: "COMPANY",
      displayName: "Body Corp",
      notes: "",
      source: "",
      consentGiven: "on",
    });
    expect(c.notes).toBeUndefined();
    expect(c.source).toBeUndefined();
    expect(c.consentGiven).toBe(true);
  });
  it("rejects a blank name and an unknown status", () => {
    expect(customerSchema.safeParse({ type: "PERSON", displayName: "  " }).success).toBe(false);
    expect(
      customerSchema.safeParse({ type: "PERSON", displayName: "A", status: "ARCHIVED" }).success,
    ).toBe(false);
  });
});

describe("contactSchema", () => {
  it("lowercases email and normalises phone", () => {
    const c = contactSchema.parse({
      name: "Sam",
      email: " Sam@Example.COM ",
      phone: "082 123 4567",
    });
    expect(c.email).toBe("sam@example.com");
    expect(c.phone).toBe("+27821234567");
  });
  it("needs an email or a phone", () => {
    const r = contactSchema.safeParse({ name: "Sam" });
    expect(r.success).toBe(false);
  });
  it("rejects a bad phone and portal access without an email", () => {
    expect(contactSchema.safeParse({ name: "Sam", phone: "12" }).success).toBe(false);
    expect(
      contactSchema.safeParse({ name: "Sam", phone: "0821234567", portalAccess: "on" }).success,
    ).toBe(false);
  });
});

describe("propertySchema", () => {
  it("converts numbers to integers and checkboxes to booleans", () => {
    const p = propertySchema.parse({
      label: "Main",
      addressLine1: "1 Test Street",
      lawnSizeSqm: "320",
      frequency: "WEEKLY",
      hasIrrigation: "on",
    });
    expect(p.lawnSizeSqm).toBe(320);
    expect(p.hasIrrigation).toBe(true);
  });
  it("only accepts http(s) map links and known frequencies", () => {
    const base = { label: "Main", addressLine1: "1 Test Street" };
    expect(propertySchema.safeParse({ ...base, mapUrl: "javascript:alert(1)" }).success).toBe(
      false,
    );
    expect(
      propertySchema.safeParse({ ...base, mapUrl: "https://maps.google.com/?q=1" }).success,
    ).toBe(true);
    expect(propertySchema.safeParse({ ...base, frequency: "DAILY" }).success).toBe(false);
  });
});
