import { describe, expect, it } from "vitest";
import {
  bulletLines,
  DEFAULT_WORDING,
  snapshotWording,
  wordingSchema,
  wordingSnapshotSchema,
} from "./wording-schema";

const org = {
  legalName: "Terra Undecim Trading (Pty) Ltd",
  tradingName: "ACE Garden Services",
  vatEnabled: false,
};
const priced = (billing: "MONTHLY" | "ONCE_OFF", lineKind: "PRICED" | "OPTIONAL" = "PRICED") => ({
  lineKind,
  billing,
});

describe("wordingSchema", () => {
  it("accepts the defaults", () => {
    expect(wordingSchema.safeParse(DEFAULT_WORDING).success).toBe(true);
  });
  it("rejects a blank tagline clause heading and an over-long validity", () => {
    expect(
      wordingSchema.safeParse({
        ...DEFAULT_WORDING,
        monthlyTerms: [{ heading: " ", body: "x" }],
      }).success,
    ).toBe(false);
    expect(wordingSchema.safeParse({ ...DEFAULT_WORDING, defaultValidityDays: 400 }).success).toBe(
      false,
    );
  });
});

describe("wordingSchema messages", () => {
  const message = (over: object) => {
    const result = wordingSchema.safeParse({ ...DEFAULT_WORDING, ...over });
    return result.success ? null : result.error.issues[0]?.message;
  };
  it("explains a bad validity in plain words", () => {
    const plain = "Enter a whole number of days from 1 to 365.";
    for (const bad of [0, 400, Number.NaN, 2.5]) {
      expect(message({ defaultValidityDays: bad }), String(bad)).toBe(plain);
    }
  });
  it("explains a line or clause that is too long", () => {
    expect(message({ everyVisitPoints: ["x".repeat(201)] })).toBe(
      "Keep each line to 200 characters or fewer.",
    );
    expect(message({ commonTerms: [{ heading: "h".repeat(81), body: "x" }] })).toBe(
      "Keep this to 80 characters or fewer.",
    );
    expect(message({ commonTerms: [{ heading: "h", body: "x".repeat(1501) }] })).toBe(
      "Keep this to 1500 characters or fewer.",
    );
  });
});

describe("snapshotWording", () => {
  it("includes only the terms that apply, plus the common clauses", () => {
    const monthlyOnly = snapshotWording(DEFAULT_WORDING, [priced("MONTHLY")], org);
    expect(monthlyOnly.termSections.map((s) => s.title)).toEqual(["Monthly contract", "General"]);
    const onceOffOnly = snapshotWording(DEFAULT_WORDING, [priced("ONCE_OFF")], org);
    expect(onceOffOnly.termSections.map((s) => s.title)).toEqual(["Once-off work", "General"]);
    const both = snapshotWording(DEFAULT_WORDING, [priced("MONTHLY"), priced("ONCE_OFF")], org);
    expect(both.termSections.map((s) => s.title)).toEqual([
      "Monthly contract",
      "Once-off work",
      "General",
    ]);
  });
  it("counts an optional monthly add-on as monthly work", () => {
    const snap = snapshotWording(DEFAULT_WORDING, [priced("MONTHLY", "OPTIONAL")], org);
    expect(snap.termSections[0]?.title).toBe("Monthly contract");
  });
  it("copies the business details and the VAT switch, and survives a round trip", () => {
    const snap = snapshotWording(DEFAULT_WORDING, [priced("MONTHLY")], org);
    expect(snap.business.legalName).toBe("Terra Undecim Trading (Pty) Ltd");
    expect(snap.vatEnabled).toBe(false);
    expect(wordingSnapshotSchema.parse(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
  });
});

describe("bulletLines", () => {
  it("makes one bullet per non-blank line and trims each", () => {
    expect(bulletLines("  Cutting of all lawns \n\n Edging of borders\r\n")).toEqual([
      "Cutting of all lawns",
      "Edging of borders",
    ]);
  });
});
