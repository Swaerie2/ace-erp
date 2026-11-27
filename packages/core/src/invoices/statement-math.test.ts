import { describe, expect, it } from "vitest";
import {
  buildStatementData,
  defaultStatementPeriod,
  statementPeriodProblem,
  type StatementInvoiceInput,
  type StatementPaymentInput,
} from "./statement-math";

const inv = (over: Partial<StatementInvoiceInput>): StatementInvoiceInput => ({
  id: "i",
  reference: "INV-2026-0001",
  issuedOn: "2026-10-20",
  dueOn: "2026-10-31",
  totalCents: 100000,
  allocatedCents: 0,
  customerId: "own",
  customerName: "ZZ Own",
  ...over,
});
const pay = (over: Partial<StatementPaymentInput>): StatementPaymentInput => ({
  id: "p",
  receivedOn: "2026-11-02",
  amountCents: 50000,
  allocatedCents: 50000,
  reference: null,
  ...over,
});

describe("buildStatementData", () => {
  it("works out the opening balance, the entries with a running balance and the closing balance", () => {
    const data = buildStatementData({
      from: "2026-11-01",
      to: "2026-11-30",
      today: "2026-12-05",
      ownCustomerId: "own",
      invoices: [
        inv({
          id: "old",
          reference: "INV-2026-0001",
          issuedOn: "2026-10-20",
          allocatedCents: 100000,
        }),
        inv({ id: "nov", reference: "INV-2026-0002", issuedOn: "2026-11-20", dueOn: "2026-11-30" }),
        inv({ id: "dec", reference: "INV-2026-0003", issuedOn: "2026-12-01" }),
      ],
      payments: [
        pay({ id: "p-oct", receivedOn: "2026-10-25", amountCents: 60000, allocatedCents: 60000 }),
        pay({ id: "p-nov", receivedOn: "2026-11-02", amountCents: 50000, allocatedCents: 40000 }),
      ],
    });
    // before 1 Nov: R1,000 invoiced, R600 paid
    expect(data.openingCents).toBe(40000);
    expect(data.invoicedCents).toBe(100000);
    expect(data.paidCents).toBe(50000);
    expect(data.closingCents).toBe(90000);
    expect(
      data.entries.map((e) => [e.date, e.kind, e.debitCents, e.creditCents, e.balanceCents]),
    ).toEqual([
      ["2026-11-02", "PAYMENT", 0, 50000, -10000],
      ["2026-11-20", "INVOICE", 100000, 0, 90000],
    ]);
    // R100 of the November payment is not allocated yet
    expect(data.creditCents).toBe(10000);
    // the December invoice is after the period and not listed at all
    expect(data.outstanding.map((o) => o.id)).toEqual(["nov"]);
    expect(data.outstanding[0]).toMatchObject({ balanceCents: 100000, overdue: true });
    expect(data.byComplex).toEqual([]);
  });

  it("lists invoices before payments on the same day", () => {
    const data = buildStatementData({
      from: "2026-11-01",
      to: "2026-11-30",
      today: "2026-11-10",
      ownCustomerId: "own",
      invoices: [
        inv({ id: "a", issuedOn: "2026-11-05", dueOn: "2026-11-30", allocatedCents: 100000 }),
      ],
      payments: [
        pay({ id: "b", receivedOn: "2026-11-05", amountCents: 100000, allocatedCents: 100000 }),
      ],
    });
    expect(data.entries.map((e) => e.kind)).toEqual(["INVOICE", "PAYMENT"]);
    expect(data.closingCents).toBe(0);
    expect(data.outstanding).toEqual([]);
  });

  it("breaks an agency's statement down per complex", () => {
    const data = buildStatementData({
      from: "2026-11-01",
      to: "2026-11-30",
      today: "2026-11-25",
      ownCustomerId: "agency",
      invoices: [
        inv({
          id: "a1",
          customerId: "a",
          customerName: "ZZ Complex A",
          issuedOn: "2026-11-20",
          totalCents: 30000,
        }),
        inv({
          id: "b1",
          customerId: "b",
          customerName: "ZZ Complex B",
          issuedOn: "2026-11-20",
          totalCents: 50000,
          allocatedCents: 50000,
        }),
        inv({
          id: "a0",
          customerId: "a",
          customerName: "ZZ Complex A",
          issuedOn: "2026-10-20",
          totalCents: 30000,
        }),
      ],
      payments: [
        pay({ id: "p", receivedOn: "2026-11-21", amountCents: 50000, allocatedCents: 50000 }),
      ],
    });
    expect(data.byComplex).toEqual([
      {
        customerId: "a",
        customerName: "ZZ Complex A",
        invoicedCents: 30000,
        outstandingCents: 60000,
      },
      { customerId: "b", customerName: "ZZ Complex B", invoicedCents: 50000, outstandingCents: 0 },
    ]);
    expect(data.entries.find((e) => e.id === "a1")?.customerName).toBe("ZZ Complex A");
    // closing = what is still owed minus unallocated credit
    expect(data.closingCents).toBe(60000);
  });
});

describe("statement periods", () => {
  it("defaults to the start of the month two months back until today", () => {
    expect(defaultStatementPeriod("2026-11-27")).toEqual({ from: "2026-09-01", to: "2026-11-27" });
    expect(defaultStatementPeriod("2027-01-05")).toEqual({ from: "2026-11-01", to: "2027-01-05" });
  });
  it("refuses a backwards, invalid or too long period", () => {
    expect(statementPeriodProblem("2026-11-01", "2026-11-30")).toBeNull();
    expect(statementPeriodProblem("2026-12-01", "2026-11-30")).toBe(
      "The start date must be on or before the end date.",
    );
    expect(statementPeriodProblem("2026-02-30", "2026-11-30")).toBe("Choose valid dates.");
    expect(statementPeriodProblem("2020-01-01", "2026-11-30")).toBe(
      "Choose a period of three years or less.",
    );
  });
});
