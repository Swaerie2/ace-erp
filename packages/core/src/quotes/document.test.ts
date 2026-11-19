import { describe, expect, it } from "vitest";
import { buildQuoteDocument, type DocumentInput } from "./document";
import { DEFAULT_WORDING, snapshotWording } from "./wording-schema";

const org = {
  legalName: "Terra Undecim Trading (Pty) Ltd",
  tradingName: "ACE Garden Services",
  vatEnabled: false,
};

function input(over: Partial<DocumentInput> = {}): DocumentInput {
  const lines = [
    {
      id: "l1",
      lineKind: "PRICED",
      billing: "MONTHLY",
      frequency: "WEEKLY",
      description: "Weekly garden maintenance, as per scope",
      amountCents: 115000,
      chosen: false,
    },
    {
      id: "l2",
      lineKind: "OPTIONAL",
      billing: "MONTHLY",
      frequency: "AS_REQUIRED",
      description: "Weed treatment",
      amountCents: 10000,
      chosen: false,
    },
    {
      id: "l3",
      lineKind: "INCLUDED",
      billing: null,
      frequency: null,
      description: "Green waste removal",
      amountCents: null,
      chosen: false,
    },
  ] as DocumentInput["lines"];
  return {
    status: "ISSUED",
    reference: "QUO-2026-0104",
    issuedDate: "2026-11-12",
    validUntil: "2026-12-12",
    preparedFor: {
      name: "A. Client",
      email: "a@example.com",
      phone: "082 000 0000",
      siteLabel: "Main",
      siteAddress: "1 Test Road, Testville",
    },
    scope: [
      {
        name: "Lawn Mowing & Edging",
        description: "Cutting of all lawns\nEdging of borders",
        kind: "CORE",
        included: true,
      },
      {
        name: "Hedge & Shrub Trimming",
        description: "Shaping hedges",
        kind: "CORE",
        included: false,
      },
      {
        name: "Weed Treatment",
        description: "Weed control",
        kind: "OPTIONAL_EXTRA",
        included: false,
      },
    ],
    lines,
    wording: snapshotWording(DEFAULT_WORDING, lines, org),
    ...over,
  };
}

describe("buildQuoteDocument", () => {
  it("lists included services with bullets and excluded ones by name, plus the standard exclusions", () => {
    const doc = buildQuoteDocument(input());
    expect(doc.scope.included).toEqual([
      { name: "Lawn Mowing & Edging", bullets: ["Cutting of all lawns", "Edging of borders"] },
    ]);
    expect(doc.scope.excludedNames).toEqual(["Hedge & Shrub Trimming", "Weed Treatment"]);
    expect(doc.scope.standardExclusions).toHaveLength(3);
  });
  it("builds pricing rows, the totals and the summary", () => {
    const doc = buildQuoteDocument(input());
    expect(doc.pricing.rows.map((r) => [r.kind, r.frequencyLabel, r.amountLabel])).toEqual([
      ["PRICED", "Weekly", "R1,150.00"],
      ["OPTIONAL", "As required", "+R100.00"],
      ["INCLUDED", "", "Included"],
    ]);
    expect(doc.pricing.totals.monthly).toBe("R1,150.00");
    expect(doc.pricing.totals.monthlyWithOptions).toBe("R1,250.00");
    expect(doc.pricing.totals.onceOff).toBeNull();
    expect(doc.summary.monthlyTotal).toBe("R1,150.00");
    expect(doc.summary.frequencyLabel).toBe("Weekly");
    expect(doc.summary.optionalNote).toBe("Optional add-ons available");
  });
  it("shows the not-VAT-registered note while VAT is off", () => {
    expect(buildQuoteDocument(input()).vatNote).toBe(
      "All amounts in ZAR. ACE Garden Services is not VAT registered, no VAT is charged.",
    );
  });
  it("uses the reference or says Draft", () => {
    expect(buildQuoteDocument(input()).reference).toBe("QUO-2026-0104");
    expect(buildQuoteDocument(input({ reference: null, status: "DRAFT" })).reference).toBe("Draft");
  });
  it("counts chosen optional add-ons into the accepted totals", () => {
    const lines = input().lines.map((l) => (l.id === "l2" ? { ...l, chosen: true } : l));
    const doc = buildQuoteDocument(input({ status: "ACCEPTED", lines }));
    expect(doc.pricing.acceptedMonthly).toBe("R1,250.00");
  });
  it("has no em dashes anywhere in the generated labels", () => {
    expect(JSON.stringify(buildQuoteDocument(input()))).not.toContain("—");
  });
});
