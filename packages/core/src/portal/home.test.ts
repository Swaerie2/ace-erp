import { describe, expect, it } from "vitest";
import { fromDateString } from "../quotes/reference";
import { groupPortalHome, type HomeQuoteRow } from "./home";

const agency = "a0000000-0000-4000-8000-000000000001";
const complex = "c0000000-0000-4000-8000-000000000001";
const today = "2026-11-23";

const quote = (
  over: Partial<HomeQuoteRow> & { id: string; customerId: string; propertyId: string },
): HomeQuoteRow => ({
  status: "ISSUED",
  numberYear: 2026,
  numberSeq: 1,
  revision: 1,
  validUntil: fromDateString("2026-12-31"),
  issuedAt: new Date("2026-11-01T08:00:00.000Z"),
  ...over,
});

describe("groupPortalHome", () => {
  const groups = groupPortalHome({
    customers: [
      { id: complex, displayName: "ZZ Complex Bravo", status: "ACTIVE" },
      { id: agency, displayName: "ZZ Agency Alpha", status: "ACTIVE" },
    ],
    properties: [
      {
        id: "p2",
        customerId: complex,
        label: "Block B",
        addressLine1: "2 ZZ Road",
        addressLine2: null,
        suburb: "ZZ Suburb",
        city: null,
        postalCode: "7441",
      },
      {
        id: "p1",
        customerId: complex,
        label: "Block A",
        addressLine1: "1 ZZ Road",
        addressLine2: null,
        suburb: null,
        city: null,
        postalCode: null,
      },
      {
        id: "pa",
        customerId: agency,
        label: "Office",
        addressLine1: "9 ZZ Street",
        addressLine2: null,
        suburb: null,
        city: null,
        postalCode: null,
      },
    ],
    quotes: [
      quote({ id: "open", customerId: agency, propertyId: "pa", numberSeq: 5 }),
      quote({
        id: "accepted",
        customerId: complex,
        propertyId: "p1",
        status: "ACCEPTED",
        numberSeq: 6,
        issuedAt: new Date("2026-11-10T08:00:00.000Z"),
      }),
      quote({
        id: "expired",
        customerId: complex,
        propertyId: "p1",
        numberSeq: 7,
        validUntil: fromDateString("2026-11-01"),
      }),
      quote({
        id: "orphan",
        customerId: complex,
        propertyId: "archived-property",
        status: "DECLINED",
        numberSeq: 8,
        revision: 2,
      }),
      quote({
        id: "withdrawn",
        customerId: complex,
        propertyId: "p1",
        status: "WITHDRAWN",
        numberSeq: 9,
      }),
    ],
    managedCustomerIds: [complex],
    today,
  });

  it("puts own customers first, then managed complexes, each by name", () => {
    expect(groups.map((g) => [g.name, g.managed])).toEqual([
      ["ZZ Agency Alpha", false],
      ["ZZ Complex Bravo", true],
    ]);
  });
  it("lists properties by label with a one-line address", () => {
    expect(groups[1]?.properties.map((p) => [p.label, p.address])).toEqual([
      ["Block A", "1 ZZ Road"],
      ["Block B", "2 ZZ Road, ZZ Suburb, 7441"],
    ]);
  });
  it("shows each quote's state and reference, newest first, and never a withdrawn one", () => {
    expect(groups[1]?.properties[0]?.quotes.map((q) => [q.id, q.state, q.reference])).toEqual([
      ["accepted", "ACCEPTED", "QUO-2026-0006"],
      ["expired", "EXPIRED", "QUO-2026-0007"],
    ]);
    expect(groups[0]?.properties[0]?.quotes.map((q) => [q.id, q.state])).toEqual([
      ["open", "OPEN"],
    ]);
    const all = groups.flatMap((g) => [...g.properties.flatMap((p) => p.quotes), ...g.otherQuotes]);
    expect(all.map((q) => q.id)).not.toContain("withdrawn");
  });
  it("keeps a quote whose property is no longer listed under 'other quotes'", () => {
    expect(groups[1]?.otherQuotes.map((q) => [q.id, q.state, q.reference])).toEqual([
      ["orphan", "DECLINED", "QUO-2026-0008 R2"],
    ]);
  });
});
