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
