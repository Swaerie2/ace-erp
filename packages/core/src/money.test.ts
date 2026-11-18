import { describe, expect, it } from "vitest";
import { computeTotals, formatZAR, randToCents, sumCents } from "./money";

describe("randToCents", () => {
  it("parses plain, comma and R-prefixed amounts", () => {
    expect(randToCents("1234.56")).toBe(123456);
    expect(randToCents("1,234.56")).toBe(123456);
    expect(randToCents("R1,234.56")).toBe(123456);
    expect(randToCents("R 450")).toBe(45000);
    expect(randToCents("0.5")).toBe(50);
  });

  it("handles negatives", () => {
    expect(randToCents("-12.30")).toBe(-1230);
  });

  it("rejects more than two decimals instead of rounding", () => {
    expect(() => randToCents("10.999")).toThrow();
  });

  it("rejects text", () => {
    expect(() => randToCents("abc")).toThrow();
    expect(() => randToCents("")).toThrow();
  });
});

describe("formatZAR", () => {
  it("formats in ACE house style", () => {
    expect(formatZAR(123456)).toBe("R1,234.56");
    expect(formatZAR(5)).toBe("R0.05");
    expect(formatZAR(100000000)).toBe("R1,000,000.00");
    expect(formatZAR(-1230)).toBe("-R12.30");
    expect(formatZAR(0)).toBe("R0.00");
  });

  it("refuses fractional cents", () => {
    expect(() => formatZAR(10.5)).toThrow();
  });
});

describe("sumCents", () => {
  it("adds exactly, with no floating point drift", () => {
    expect(sumCents([10, 20])).toBe(30);
    expect(sumCents([])).toBe(0);
  });
});

describe("computeTotals", () => {
  const off = { vatEnabled: false, vatRateBps: 0 };

  it("adds no VAT while VAT is off (ACE is not VAT registered)", () => {
    expect(computeTotals([45000, 12000], off)).toEqual({
      subtotal: 57000,
      vat: 0,
      total: 57000,
    });
  });

  it("ignores a rate while VAT is off", () => {
    expect(computeTotals([10000], { vatEnabled: false, vatRateBps: 1500 }).vat).toBe(0);
  });

  it("adds 15% VAT only when switched on", () => {
    expect(computeTotals([10000], { vatEnabled: true, vatRateBps: 1500 })).toEqual({
      subtotal: 10000,
      vat: 1500,
      total: 11500,
    });
  });

  it("rounds VAT to the nearest cent", () => {
    // 15% of R0.03 is 0.45c, which rounds to 0
    expect(computeTotals([3], { vatEnabled: true, vatRateBps: 1500 }).vat).toBe(0);
    // 15% of R0.10 is 1.5c, which rounds to 2
    expect(computeTotals([10], { vatEnabled: true, vatRateBps: 1500 }).vat).toBe(2);
  });
});
