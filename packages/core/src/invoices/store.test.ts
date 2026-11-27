import { describe, expect, it } from "vitest";
import { isMonthlyDuplicate, sortedUniqueIds } from "./store";

describe("sortedUniqueIds (the lock order)", () => {
  it("lowercases before removing repeats and sorting", () => {
    const a = "aaaaaaaa-1111-4111-8111-111111111111";
    const b = "bbbbbbbb-2222-4222-8222-222222222222";
    expect(sortedUniqueIds([b, a.toUpperCase(), a, b.toUpperCase()])).toEqual([a, b]);
    // Uppercase "B..." would sort before lowercase "a..." without lowercasing.
    expect(sortedUniqueIds([b.toUpperCase(), a])).toEqual([a, b]);
  });
});

// The shapes below are copied from real errors Prisma 7 (adapter-pg) threw against the dev database.
const prismaUnique = (index: string, modelName = "Invoice") => ({
  name: "PrismaClientKnownRequestError",
  code: "P2002",
  meta: {
    driverAdapterError: {
      name: "DriverAdapterError",
      cause: {
        originalCode: "23505",
        originalMessage: `duplicate key value violates unique constraint "${index}"`,
        kind: "UniqueConstraintViolation",
        constraint: { index },
        table: "invoices",
      },
    },
    modelName,
  },
  message: `Unique constraint failed on the constraint: \`${index}\``,
});

describe("isMonthlyDuplicate", () => {
  it("is true only for the monthly once-per-month index", () => {
    expect(isMonthlyDuplicate(prismaUnique("invoices_monthly_once_per_month"))).toBe(true);
    expect(isMonthlyDuplicate(prismaUnique("invoices_numberYear_numberSeq_key"))).toBe(false);
    expect(
      isMonthlyDuplicate(
        prismaUnique("payment_allocations_paymentId_invoiceId_key", "PaymentAllocation"),
      ),
    ).toBe(false);
  });

  it("accepts an older Prisma error that only names the fields", () => {
    expect(
      isMonthlyDuplicate({ code: "P2002", meta: { target: ["customerId", "serviceMonth"] } }),
    ).toBe(true);
    expect(
      isMonthlyDuplicate({ code: "P2002", meta: { target: ["numberYear", "numberSeq"] } }),
    ).toBe(false);
    expect(isMonthlyDuplicate({ code: "P2002" })).toBe(false);
  });

  it("falls back to raw Postgres errors that name the index", () => {
    expect(
      isMonthlyDuplicate({ code: "23505", constraint: "invoices_monthly_once_per_month" }),
    ).toBe(true);
    expect(
      isMonthlyDuplicate({ code: "23505", constraint: "invoices_numberYear_numberSeq_key" }),
    ).toBe(false);
    const rawQuery = { ...prismaUnique("invoices_monthly_once_per_month"), code: "P2010" };
    expect(isMonthlyDuplicate(rawQuery)).toBe(true);
    // Naming the index is not enough without a unique-violation code.
    expect(isMonthlyDuplicate({ code: "P2003", message: "invoices_monthly_once_per_month" })).toBe(
      false,
    );
  });

  it("is false for things that are not database errors", () => {
    expect(isMonthlyDuplicate(null)).toBe(false);
    expect(isMonthlyDuplicate("invoices_monthly_once_per_month")).toBe(false);
    expect(isMonthlyDuplicate(new Error("boom"))).toBe(false);
  });
});
