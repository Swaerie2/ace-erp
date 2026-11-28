import { describe, expect, it } from "vitest";
import {
  fitDescription,
  formatBillingAddress,
  invoiceDisplayStatus,
  issueProblems,
  parseSignedRandToCents,
  suggestAllocations,
  sumLineCents,
} from "./money";

describe("parseSignedRandToCents", () => {
  it("reads positive and negative rand amounts", () => {
    expect(parseSignedRandToCents("1150")).toBe(115000);
    expect(parseSignedRandToCents("R 1 150,50")).toBe(115050);
    expect(parseSignedRandToCents("-100")).toBe(-10000);
    expect(parseSignedRandToCents(" -R50.5 ")).toBe(-5050);
  });
  it("never returns negative zero", () => {
    // toBe uses Object.is, so -0 would fail here
    expect(parseSignedRandToCents("-0")).toBe(0);
    expect(parseSignedRandToCents("-0.00")).toBe(0);
  });
  it("refuses anything that is not an amount", () => {
    for (const bad of ["", "-", "abc", "1.234", "--5", "12-"]) {
      expect(parseSignedRandToCents(bad), bad).toBeNull();
    }
  });
});

describe("totals and status", () => {
  it("adds whole cents, adjustments included", () => {
    expect(
      sumLineCents([{ amountCents: 115000 }, { amountCents: 10000 }, { amountCents: -5000 }]),
    ).toBe(120000);
    expect(sumLineCents([])).toBe(0);
  });
  it("works out the status shown from the stored status, balance and due date", () => {
    const today = "2026-12-05";
    const base = { status: "ISSUED" as const, totalCents: 100000, dueDate: "2026-12-31" };
    expect(invoiceDisplayStatus({ ...base, status: "DRAFT", allocatedCents: 0 }, today)).toBe(
      "DRAFT",
    );
    expect(invoiceDisplayStatus({ ...base, status: "VOID", allocatedCents: 0 }, today)).toBe(
      "VOID",
    );
    expect(invoiceDisplayStatus({ ...base, allocatedCents: 0 }, today)).toBe("UNPAID");
    expect(invoiceDisplayStatus({ ...base, allocatedCents: 40000 }, today)).toBe("PART_PAID");
    expect(invoiceDisplayStatus({ ...base, allocatedCents: 100000 }, today)).toBe("PAID");
    // due yesterday with money still owed
    expect(
      invoiceDisplayStatus({ ...base, dueDate: "2026-12-04", allocatedCents: 40000 }, today),
    ).toBe("OVERDUE");
    // due today is not yet overdue
    expect(invoiceDisplayStatus({ ...base, dueDate: "2026-12-05", allocatedCents: 0 }, today)).toBe(
      "UNPAID",
    );
    // paid in full is never overdue
    expect(
      invoiceDisplayStatus({ ...base, dueDate: "2026-11-01", allocatedCents: 100000 }, today),
    ).toBe("PAID");
  });
});

describe("suggestAllocations", () => {
  const invoices = [
    { id: "b", balanceCents: 50000, dueDate: "2026-11-30", reference: "INV-2026-0002" },
    { id: "a", balanceCents: 30000, dueDate: "2026-10-31", reference: "INV-2026-0001" },
    { id: "c", balanceCents: 20000, dueDate: "2026-11-30", reference: "INV-2026-0003" },
    { id: "z", balanceCents: 0, dueDate: "2026-09-30", reference: "INV-2026-0000" },
  ];
  it("pays the oldest due first, then by number, and stops when the money runs out", () => {
    expect(suggestAllocations(70000, invoices)).toEqual([
      { invoiceId: "a", amountCents: 30000 },
      { invoiceId: "b", amountCents: 40000 },
    ]);
  });
  it("leaves the rest unallocated when there is more money than owed", () => {
    expect(suggestAllocations(200000, invoices)).toEqual([
      { invoiceId: "a", amountCents: 30000 },
      { invoiceId: "b", amountCents: 50000 },
      { invoiceId: "c", amountCents: 20000 },
    ]);
  });
  it("suggests nothing for nothing", () => {
    expect(suggestAllocations(0, invoices)).toEqual([]);
  });
});

describe("issueProblems", () => {
  const today = "2026-11-20";
  it("lists every problem in plain words", () => {
    expect(
      issueProblems(
        {
          lines: [
            { kind: "SERVICE", description: " ", amountCents: 100 },
            { kind: "SERVICE", description: "Garden", amountCents: -100 },
            { kind: "ADJUSTMENT", description: "Discount", amountCents: -500 },
          ],
          dueDate: "2026-11-19",
        },
        today,
      ),
    ).toEqual([
      "Line 1 needs a description.",
      "Line 2 cannot be negative. Only an adjustment can be.",
      "The total must be above zero.",
      "The due date has passed. Change it before issuing.",
    ]);
  });
  it("needs at least one line and no zero amounts", () => {
    expect(issueProblems({ lines: [], dueDate: today }, today)).toEqual([
      "Add at least one line.",
      "The total must be above zero.",
    ]);
    expect(
      issueProblems(
        { lines: [{ kind: "ONCE_OFF", description: "Clean-up", amountCents: 0 }], dueDate: today },
        today,
      ),
    ).toEqual(["Line 1 needs an amount.", "The total must be above zero."]);
  });
  it("refuses a total too large to store (above 2147483647 cents)", () => {
    const line = (amountCents: number) => ({
      kind: "ONCE_OFF" as const,
      description: "Large job",
      amountCents,
    });
    const big = Array.from({ length: 21 }, () => line(100_000_000));
    expect(issueProblems({ lines: [...big, line(47_483_647)], dueDate: today }, today)).toEqual([]);
    expect(issueProblems({ lines: [...big, line(47_483_648)], dueDate: today }, today)).toEqual([
      "The total is too large to issue.",
    ]);
  });
  it("finds nothing wrong with a complete invoice", () => {
    expect(
      issueProblems(
        {
          lines: [
            {
              kind: "SERVICE",
              description: "Main: Weekly garden maintenance",
              amountCents: 115000,
            },
            { kind: "ADJUSTMENT", description: "Discount", amountCents: -15000 },
          ],
          dueDate: today,
        },
        today,
      ),
    ).toEqual([]);
  });
});

describe("addresses and descriptions", () => {
  it("joins the billing address lines that are filled in", () => {
    expect(
      formatBillingAddress({
        billingLine1: "1 Test Road",
        billingLine2: null,
        billingSuburb: "Testville",
        billingCity: "Pretoria",
        billingPostalCode: "0001",
      }),
    ).toBe("1 Test Road, Testville, Pretoria, 0001");
    expect(
      formatBillingAddress({
        billingLine1: null,
        billingLine2: " ",
        billingSuburb: null,
        billingCity: null,
        billingPostalCode: null,
      }),
    ).toBeNull();
  });
  it("cuts descriptions to 300 characters", () => {
    expect(fitDescription("Short")).toBe("Short");
    const long = fitDescription("x".repeat(400));
    expect(long).toHaveLength(300);
    expect(long.endsWith("...")).toBe(true);
  });
});
