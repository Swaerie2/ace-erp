import { describe, expect, it } from "vitest";
import {
  addDays,
  displayStatus,
  formatDateSA,
  formatDateTimeSA,
  formatQuoteReference,
  fromDateString,
  isValidDateString,
  toDateString,
  todaySA,
  yearSA,
} from "./reference";

describe("formatQuoteReference", () => {
  it("pads the running number to four digits", () => {
    expect(formatQuoteReference({ numberYear: 2026, numberSeq: 104, revision: 1 })).toBe(
      "QUO-2026-0104",
    );
    expect(formatQuoteReference({ numberYear: 2026, numberSeq: 7, revision: 1 })).toBe(
      "QUO-2026-0007",
    );
  });
  it("lets the number grow past four digits", () => {
    expect(formatQuoteReference({ numberYear: 2027, numberSeq: 12345, revision: 1 })).toBe(
      "QUO-2027-12345",
    );
  });
  it("adds a revision mark from the second revision on", () => {
    expect(formatQuoteReference({ numberYear: 2026, numberSeq: 104, revision: 2 })).toBe(
      "QUO-2026-0104 R2",
    );
  });
  it("is null for a draft", () => {
    expect(formatQuoteReference({ numberYear: null, numberSeq: null, revision: 1 })).toBeNull();
  });
});

describe("dates in South African time", () => {
  it("uses the South African calendar day, not UTC", () => {
    // 22:30 UTC on 31 December is already 00:30 on 1 January in South Africa (UTC+2).
    const now = new Date("2026-12-31T22:30:00Z");
    expect(todaySA(now)).toBe("2027-01-01");
    expect(yearSA(now)).toBe(2027);
  });
  it("adds days across a month end", () => {
    expect(addDays("2026-11-19", 30)).toBe("2026-12-19");
    expect(addDays("2026-12-20", 30)).toBe("2027-01-19");
  });
  it("round-trips date strings", () => {
    expect(toDateString(fromDateString("2026-11-19"))).toBe("2026-11-19");
  });
  it("validates date strings", () => {
    expect(isValidDateString("2026-11-19")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("19/11/2026")).toBe(false);
    expect(isValidDateString("")).toBe(false);
  });
});

describe("displayStatus", () => {
  const validUntil = fromDateString("2026-11-30");
  it("is EXPIRED only after the valid-until day", () => {
    expect(displayStatus({ status: "ISSUED", validUntil }, "2026-11-30")).toBe("ISSUED");
    expect(displayStatus({ status: "ISSUED", validUntil }, "2026-12-01")).toBe("EXPIRED");
  });
  it("never expires an answered or closed quote", () => {
    for (const status of ["DRAFT", "ACCEPTED", "DECLINED", "REPLACED", "WITHDRAWN"] as const) {
      expect(displayStatus({ status, validUntil }, "2027-06-01")).toBe(status);
    }
  });
});

describe("South African date text", () => {
  it("formats dates and times in South African time", () => {
    const d = new Date("2026-11-21T08:07:00Z"); // 10:07 in South Africa
    expect(formatDateSA(d)).toBe("21 Nov 2026");
    expect(formatDateTimeSA(d)).toBe("21 Nov 2026, 10:07");
  });
});
