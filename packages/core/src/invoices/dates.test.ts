import { describe, expect, it } from "vitest";
import {
  addMonths,
  catchUpDueDate,
  catchUpMonths,
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
  runDateFor,
  runMonthAllowed,
  serviceMonthFor,
  startMonthCatchUpNeeded,
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

describe("start-month catch-up", () => {
  it("dates the normal run for a service month: Pre the 20th before, Post the 20th of it", () => {
    expect(runDateFor("2026-12", "PRE")).toBe("2026-11-20");
    expect(runDateFor("2026-12", "POST")).toBe("2026-12-20");
    // Across the year end
    expect(runDateFor("2027-01", "PRE")).toBe("2026-12-20");
    expect(runDateFor("2027-01", "POST")).toBe("2027-01-20");
  });

  it("needs a catch-up only once the normal run is due, for this month or last month", () => {
    // Pre, first service 27 Nov, accepted 25 Nov: the run for November was on 20 Oct.
    expect(startMonthCatchUpNeeded("2026-11", "PRE", "2026-11-25")).toBe(true);
    // Post: the run for November is on 20 Nov.
    expect(startMonthCatchUpNeeded("2026-11", "POST", "2026-11-19")).toBe(false);
    expect(startMonthCatchUpNeeded("2026-11", "POST", "2026-11-20")).toBe(true);
    expect(startMonthCatchUpNeeded("2026-11", "POST", "2026-11-30")).toBe(true);
    // Last month still counts (an agreement that started last month and was never billed).
    expect(startMonthCatchUpNeeded("2026-11", "POST", "2026-12-05")).toBe(true);
    expect(startMonthCatchUpNeeded("2026-11", "PRE", "2026-12-31")).toBe(true);
    // Two months back and more: never (old history does not flood the list).
    expect(startMonthCatchUpNeeded("2026-10", "PRE", "2026-12-01")).toBe(false);
    expect(startMonthCatchUpNeeded("2026-09", "POST", "2026-11-25")).toBe(false);
    // Next month, Pre: due from the 20th of this month (that run bills next month and has been).
    expect(startMonthCatchUpNeeded("2026-12", "PRE", "2026-11-19")).toBe(false);
    expect(startMonthCatchUpNeeded("2026-12", "PRE", "2026-11-20")).toBe(true);
    expect(startMonthCatchUpNeeded("2026-12", "PRE", "2026-11-25")).toBe(true);
    // Next month, Post: its run is the 20th of next month, so never yet.
    expect(startMonthCatchUpNeeded("2026-12", "POST", "2026-11-25")).toBe(false);
    // Two months ahead: never.
    expect(startMonthCatchUpNeeded("2027-01", "PRE", "2026-11-25")).toBe(false);
  });

  it("lists last month, this month and next month", () => {
    expect(catchUpMonths("2026-11-25")).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(catchUpMonths("2026-12-01")).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(catchUpMonths("2027-01-31")).toEqual(["2026-12", "2027-01", "2027-02"]);
  });

  it("works across the year end and in February", () => {
    expect(startMonthCatchUpNeeded("2026-12", "POST", "2027-01-03")).toBe(true);
    expect(startMonthCatchUpNeeded("2027-01", "PRE", "2027-01-02")).toBe(true);
    expect(startMonthCatchUpNeeded("2027-01", "POST", "2027-01-19")).toBe(false);
    expect(startMonthCatchUpNeeded("2027-02", "POST", "2027-02-20")).toBe(true);
    expect(startMonthCatchUpNeeded("2027-02", "POST", "2027-03-01")).toBe(true);
    expect(startMonthCatchUpNeeded("2026-12", "PRE", "2027-02-01")).toBe(false);
    // Pre January from 20 December (across the year end), not before.
    expect(startMonthCatchUpNeeded("2027-01", "PRE", "2026-12-19")).toBe(false);
    expect(startMonthCatchUpNeeded("2027-01", "PRE", "2026-12-20")).toBe(true);
    expect(startMonthCatchUpNeeded("2027-01", "POST", "2026-12-28")).toBe(false);
  });

  it("refuses a month that is not a month", () => {
    expect(startMonthCatchUpNeeded("2026-13", "PRE", "2026-11-25")).toBe(false);
    expect(startMonthCatchUpNeeded("", "POST", "2026-11-25")).toBe(false);
  });

  it("is due a week from today at the earliest, never past a week after the month ends, never in the past", () => {
    // Pre November, today 25 Nov: the normal due date (31 Oct) has passed, so a week from today.
    expect(catchUpDueDate("2026-11", "PRE", "2026-11-25")).toBe("2026-12-02");
    // Post November on the 20th: a week from today (27 Nov) is later than the normal due date (25 Nov).
    expect(catchUpDueDate("2026-11", "POST", "2026-11-20")).toBe("2026-11-27");
    // A week from today would pass a week after the month end (7 Dec): 7 Dec.
    expect(catchUpDueDate("2026-11", "POST", "2026-12-03")).toBe("2026-12-07");
    // Last month, long after: never in the past, so today.
    expect(catchUpDueDate("2026-11", "PRE", "2026-12-20")).toBe("2026-12-20");
    // February 2027 has 28 days: at most 7 March.
    expect(catchUpDueDate("2027-02", "POST", "2027-03-05")).toBe("2027-03-07");
    expect(catchUpDueDate("2027-02", "POST", "2027-02-20")).toBe("2027-02-27");
    // Across the year end
    expect(catchUpDueDate("2026-12", "POST", "2026-12-28")).toBe("2027-01-04");
    // Pre next month (December, today 25 Nov): normal due date 30 Nov, a week from today is later.
    expect(catchUpDueDate("2026-12", "PRE", "2026-11-25")).toBe("2026-12-02");
    // Pre January on 20 December: a week from today (27 Dec) is before the normal due date (31 Dec).
    expect(catchUpDueDate("2027-01", "PRE", "2026-12-20")).toBe("2026-12-31");
  });
});
