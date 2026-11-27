import { describe, expect, it } from "vitest";
import { buildScope, needsWelcome, pickActingContact, type ScopeContact } from "./scope";

const agency = "a0000000-0000-4000-8000-000000000001";
const complexX = "c0000000-0000-4000-8000-000000000001";
const complexY = "c0000000-0000-4000-8000-000000000002";
const stranger = "f0000000-0000-4000-8000-000000000001";

const contact = (id: string, customerId: string, welcomed = true): ScopeContact => ({
  id,
  customerId,
  name: `ZZ Contact ${id.slice(0, 4)}`,
  welcomed,
});

describe("buildScope", () => {
  it("is null when the email has no contact with access", () => {
    expect(buildScope("zz@example.com", [], [])).toBeNull();
  });
  it("adds the complexes an own customer manages, one level only", () => {
    const scope = buildScope(
      "zz@example.com",
      [contact("1", agency)],
      [
        { id: complexX, managedById: agency },
        { id: complexY, managedById: agency },
        // managed by someone else: ignored even if passed in
        { id: stranger, managedById: complexX },
      ],
    );
    expect(scope?.ownCustomerIds).toEqual([agency]);
    expect(scope?.managedCustomerIds).toEqual([complexX, complexY]);
    expect(scope?.customerIds).toEqual([agency, complexX, complexY].sort());
  });
  it("counts a customer that is both own and managed as own", () => {
    const scope = buildScope(
      "zz@example.com",
      [contact("1", agency), contact("2", complexX)],
      [{ id: complexX, managedById: agency }],
    );
    expect(scope?.ownCustomerIds).toEqual([agency, complexX].sort());
    expect(scope?.managedCustomerIds).toEqual([]);
  });
});

describe("needsWelcome", () => {
  it("is true while any contact is not welcomed", () => {
    expect(needsWelcome(buildScope("zz@example.com", [contact("1", agency)], [])!)).toBe(false);
    expect(
      needsWelcome(
        buildScope("zz@example.com", [contact("1", agency), contact("2", complexX, false)], [])!,
      ),
    ).toBe(true);
  });
});

describe("pickActingContact", () => {
  const scope = buildScope(
    "zz@example.com",
    [contact("agency-contact", agency), contact("trustee", complexY)],
    [{ id: complexX, managedById: agency }],
  )!;
  it("uses the contact of the quote's own customer first", () => {
    expect(pickActingContact(scope, { id: complexY, managedById: agency })).toEqual({
      contactId: "trustee",
      customerId: complexY,
      forAgency: false,
    });
  });
  it("falls back to the managing agency's contact, recorded as for the agency", () => {
    expect(pickActingContact(scope, { id: complexX, managedById: agency })).toEqual({
      contactId: "agency-contact",
      customerId: agency,
      forAgency: true,
    });
  });
  it("finds nobody for an unrelated customer", () => {
    expect(pickActingContact(scope, { id: stranger, managedById: null })).toBeNull();
    expect(pickActingContact(scope, { id: stranger, managedById: complexX })).toBeNull();
  });
});
