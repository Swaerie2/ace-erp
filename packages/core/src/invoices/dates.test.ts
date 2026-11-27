import { describe, expect, it } from "vitest";
import {
  addMonths,
  currentMonthSA,
  daysInMonth,
  dueDateFor,
  firstDayOf,
  formatDayMonth,
  formatMonthLabel,
  isMonthString,
  lastDayOf,
  monthOf,
  proRata,
  runMonthAllowed,
  serviceMonthFor,
} from "./dates";

describe("months", () => {
  it("accepts YYYY-MM only", () => {
    expect(isMonthString("2026-11")).toBe(true);
    for (const bad of ["2026-13", "2026-00", "2026-1", "26-11", "2026-11-01", "", "1999-12"]) {
      expect(isMonthString(bad), bad).toBe(false);
    }
  });
  it("adds months across year ends, both ways", () => {
    expect(addMonths("2026-11", 1)).toBe("2026-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(addMonths("2026-05", -12)).toBe("2025-05");
  });
  it("knows 28, 29, 30 and 31 day months", () => {
    expect(daysInMonth("2027-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-11")).toBe(30);
    expect(daysInMonth("2026-12")).toBe(31);
    expect(firstDayOf("2026-12")).toBe("2026-12-01");
    expect(lastDayOf("2028-02")).toBe("2028-02-29");
    expect(lastDayOf("2026-11")).toBe("2026-11-30");
    expect(monthOf("2026-11-27")).toBe("2026-11");
  });
  it("reads the current month in South African time", () => {
    // 22:30 UTC on 31 Dec is already 1 Jan in South Africa.
    expect(currentMonthSA(new Date("2026-12-31T22:30:00Z"))).toBe("2027-01");
    expect(currentMonthSA(new Date("2026-11-27T10:00:00Z"))).toBe("2026-11");
  });
  it("switches month at 22:00 UTC, which is midnight in South Africa", () => {
    expect(currentMonthSA(new Date("2026-11-30T21:59:00Z"))).toBe("2026-11");
    expect(currentMonthSA(new Date("2026-11-30T22:00:00Z"))).toBe("2026-12");
  });
});

describe("the run on the 20th", () => {
  it("Pre clients: next month's service, due the last day of the run month", () => {
    expect(serviceMonthFor("2026-11", "PRE")).toBe("2026-12");
    expect(dueDateFor("2026-11", "PRE")).toBe("2026-11-30");
    expect(serviceMonthFor("2026-12", "PRE")).toBe("2027-01");
    expect(dueDateFor("2026-12", "PRE")).toBe("2026-12-31");
    expect(dueDateFor("2028-02", "PRE")).toBe("2028-02-29");
    expect(dueDateFor("2027-02", "PRE")).toBe("2027-02-28");
  });
  it("Post clients: this month's service, due the 25th", () => {
    expect(serviceMonthFor("2026-11", "POST")).toBe("2026-11");
    expect(dueDateFor("2026-11", "POST")).toBe("2026-11-25");
    expect(dueDateFor("2027-02", "POST")).toBe("2027-02-25");
  });
  it("allows run months from a year back to next month", () => {
    expect(runMonthAllowed("2026-11", "2026-11-20")).toBe(true);
    expect(runMonthAllowed("2026-12", "2026-11-20")).toBe(true);
    expect(runMonthAllowed("2025-11", "2026-11-20")).toBe(true);
    expect(runMonthAllowed("2027-01", "2026-11-20")).toBe(false);
    expect(runMonthAllowed("2025-10", "2026-11-20")).toBe(false);
    expect(runMonthAllowed("2026-13", "2026-11-20")).toBe(false);
  });
});

describe("proRata", () => {
  it("charges the days from the start date, rounded to the cent", () => {
    // 22 of 31 days of R1,150.00 = 81612.903... cents
    expect(proRata(115000, "2026-12-10", "2026-12")).toEqual({
      amountCents: 81613,
      days: 22,
      daysInMonth: 31,
    });
    // 15 of 30 days: exactly half
    expect(proRata(100001, "2026-11-16", "2026-11")).toEqual({
      amountCents: 50001,
      days: 15,
      daysInMonth: 30,
    });
    // the last day of a leap February: 1 of 29 days
    expect(proRata(29000, "2028-02-29", "2028-02")).toEqual({
      amountCents: 1000,
      days: 1,
      daysInMonth: 29,
    });
  });
  it("handles a start on the 2nd and on the 31st of a 31-day month", () => {
    // 2 Dec: 30 of 31 days
    expect(proRata(31000, "2026-12-02", "2026-12")).toEqual({
      amountCents: 30000,
      days: 30,
      daysInMonth: 31,
    });
    // 31 Dec: 1 of 31 days
    expect(proRata(31000, "2026-12-31", "2026-12")).toEqual({
      amountCents: 1000,
      days: 1,
      daysInMonth: 31,
    });
  });
  it("never charges nothing for a positive amount", () => {
    // 1 cent for 1 day of 31 rounds to 0, but at least 1 cent is charged
    expect(proRata(1, "2026-12-31", "2026-12")).toEqual({
      amountCents: 1,
      days: 1,
      daysInMonth: 31,
    });
  });
  it("is not used when the start is the 1st or outside the service month", () => {
    expect(proRata(115000, "2026-12-01", "2026-12")).toBeNull();
    expect(proRata(115000, "2026-11-20", "2026-12")).toBeNull();
    expect(proRata(115000, "2027-01-05", "2026-12")).toBeNull();
  });
});

describe("labels", () => {
  it("names months and days in plain words", () => {
    expect(formatMonthLabel("2026-12")).toBe("December 2026");
    expect(formatMonthLabel("2027-01")).toBe("January 2027");
    expect(formatDayMonth("2026-12-10")).toBe("10 Dec");
    expect(formatDayMonth("2027-02-01")).toBe("1 Feb");
  });
});
