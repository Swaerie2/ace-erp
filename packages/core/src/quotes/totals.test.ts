import { describe, expect, it } from "vitest";
import { acceptedTotals, quoteTotals, type TotalsLine } from "./totals";

const line = (over: Partial<TotalsLine>): TotalsLine => ({
  lineKind: "PRICED",
  billing: "MONTHLY",
  amountCents: 0,
  ...over,
});

describe("quoteTotals", () => {
  const lines: TotalsLine[] = [
    line({ amountCents: 115000 }), // monthly
    line({ billing: "ONCE_OFF", amountCents: 240000 }), // once-off
    line({ lineKind: "OPTIONAL", amountCents: 10000 }), // optional monthly
    line({ lineKind: "OPTIONAL", billing: "ONCE_OFF", amountCents: 5000 }), // optional once-off
    line({ lineKind: "INCLUDED", billing: null, amountCents: null }),
  ];
  it("adds each kind separately and never mixes optional into the main totals", () => {
    expect(quoteTotals(lines)).toEqual({
      monthly: 115000,
      onceOff: 240000,
      optionalMonthly: 10000,
      optionalOnceOff: 5000,
      monthlyWithOptions: 125000,
      onceOffWithOptions: 245000,
    });
  });
  it("is all zero for no lines", () => {
    expect(quoteTotals([]).monthly).toBe(0);
  });
  it("ignores a line with no amount yet (an unfinished draft)", () => {
    expect(quoteTotals([line({ amountCents: null })]).monthly).toBe(0);
  });
});

describe("acceptedTotals", () => {
  it("counts a chosen optional add-on as part of the total and leaves out the others", () => {
    const lines: TotalsLine[] = [
      line({ amountCents: 115000 }),
      line({ lineKind: "OPTIONAL", amountCents: 10000, chosen: true }),
      line({ lineKind: "OPTIONAL", billing: "ONCE_OFF", amountCents: 5000, chosen: false }),
    ];
    expect(acceptedTotals(lines)).toEqual({ monthly: 125000, onceOff: 0 });
  });
});
