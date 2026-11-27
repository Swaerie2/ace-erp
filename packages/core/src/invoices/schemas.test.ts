import { describe, expect, it } from "vitest";
import { MAX_LINE_CENTS } from "./money";
import {
  allocationFormSchema,
  bankDetailsReady,
  draftInputFromForm,
  invoiceDraftSchema,
  invoiceSettingsFormSchema,
  paymentInputFromForm,
  reasonSchema,
} from "./schemas";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

describe("draftInputFromForm", () => {
  it("reads the rows, skips empty and removed ones, and keeps line ids", () => {
    const result = draftInputFromForm({
      version: "3",
      dueDate: "2026-12-31",
      "line-0-id": ID1,
      "line-0-kind": "SERVICE",
      "line-0-description": "Main: Weekly garden maintenance",
      "line-0-amount": "1150",
      "line-1-id": ID2,
      "line-1-kind": "LATE_FEE",
      "line-1-description": "Late payment fee: INV-2026-0001",
      "line-1-amount": "100",
      "line-1-remove": "on",
      "line-2-kind": "ADJUSTMENT",
      "line-2-description": "Discount",
      "line-2-amount": "-50",
      "line-3-kind": "SERVICE",
      "line-3-description": "",
      "line-3-amount": "",
    });
    expect(result).toEqual({
      ok: true,
      input: {
        version: 3,
        dueDate: "2026-12-31",
        lines: [
          {
            id: ID1,
            kind: "SERVICE",
            description: "Main: Weekly garden maintenance",
            amountCents: 115000,
          },
          { id: null, kind: "ADJUSTMENT", description: "Discount", amountCents: -5000 },
        ],
      },
    });
  });

  it("an empty due date means the default", () => {
    const result = draftInputFromForm({ version: "1", dueDate: "" });
    expect(result).toEqual({ ok: true, input: { version: 1, dueDate: null, lines: [] } });
  });

  it("explains each problem next to its box", () => {
    const result = draftInputFromForm({
      version: "1",
      dueDate: "2026-02-30",
      "line-0-kind": "SERVICE",
      "line-0-description": "Garden",
      "line-0-amount": "-10",
      "line-1-kind": "ONCE_OFF",
      "line-1-description": "",
      "line-1-amount": "abc",
      "line-2-kind": "NONSENSE",
      "line-2-description": "x",
      "line-2-amount": "1",
    });
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        dueDate: "Choose a valid date.",
        "line-0-amount": "Only an adjustment can be negative.",
        "line-1-description": "Enter a description.",
        "line-1-amount": "Enter an amount, for example 1150 or -100.",
        "line-2-kind": "Choose what kind of line this is.",
      },
    });
  });

  it("refuses a zero amount and a line above R1 000 000 either way, but allows exactly the limit", () => {
    const row = (amount: string, kind = "SERVICE") => ({
      version: "1",
      "line-0-kind": kind,
      "line-0-description": "Garden",
      "line-0-amount": amount,
    });
    expect(draftInputFromForm(row("0"))).toEqual({
      ok: false,
      fieldErrors: { "line-0-amount": "Enter an amount, for example 1150 or -100." },
    });
    expect(draftInputFromForm(row("-0", "ADJUSTMENT"))).toEqual({
      ok: false,
      fieldErrors: { "line-0-amount": "Enter an amount, for example 1150 or -100." },
    });
    expect(draftInputFromForm(row("1000000.01"))).toEqual({
      ok: false,
      fieldErrors: { "line-0-amount": "Keep each line to R1 000 000 or less." },
    });
    expect(draftInputFromForm(row("-1000000.01", "ADJUSTMENT"))).toEqual({
      ok: false,
      fieldErrors: { "line-0-amount": "Keep each line to R1 000 000 or less." },
    });
    const atLimit = draftInputFromForm(row("1000000"));
    expect(atLimit.ok && atLimit.input.lines[0]?.amountCents).toBe(MAX_LINE_CENTS);
  });

  it("refuses a damaged form", () => {
    expect(draftInputFromForm({ version: "x" })).toEqual({
      ok: false,
      fieldErrors: { form: "Refresh the page and try again." },
    });
    expect(
      draftInputFromForm({ version: "1", "line-0-id": "not-an-id", "line-0-kind": "SERVICE" }),
    ).toEqual({ ok: false, fieldErrors: { form: "Refresh the page and try again." } });
  });

  it("refuses a 41st line instead of dropping it, unless it is removed or empty", () => {
    const tooMany = { ok: false, fieldErrors: { form: "Keep the invoice to 40 lines or fewer." } };
    const extra = { "line-40-kind": "SERVICE", "line-40-description": "x", "line-40-amount": "1" };
    expect(draftInputFromForm({ version: "1", ...extra })).toEqual(tooMany);
    expect(draftInputFromForm({ version: "1", "line-99-amount": "5" })).toEqual(tooMany);
    expect(draftInputFromForm({ version: "1", ...extra, "line-40-remove": "on" })).toEqual({
      ok: true,
      input: { version: 1, dueDate: null, lines: [] },
    });
    expect(
      draftInputFromForm({ version: "1", "line-40-kind": "SERVICE", "line-40-description": " " }),
    ).toEqual({ ok: true, input: { version: 1, dueDate: null, lines: [] } });
  });

  it("refuses control characters in a description", () => {
    expect(
      draftInputFromForm({
        version: "1",
        "line-0-kind": "SERVICE",
        "line-0-description": "Garden\u0000",
        "line-0-amount": "10",
      }),
    ).toEqual({
      ok: false,
      fieldErrors: { "line-0-description": "Remove the special characters." },
    });
  });
});

describe("invoiceDraftSchema", () => {
  const line = (amountCents: number, kind = "SERVICE") => ({
    version: 1,
    dueDate: null,
    lines: [{ id: null, kind, description: "Garden", amountCents }],
  });
  it("accepts whole cents up to the limit", () => {
    expect(invoiceDraftSchema.safeParse(line(MAX_LINE_CENTS)).success).toBe(true);
    expect(invoiceDraftSchema.safeParse(line(-MAX_LINE_CENTS, "ADJUSTMENT")).success).toBe(true);
  });
  it("refuses zero, part cents, amounts above the limit and a negative line that is not an adjustment", () => {
    for (const bad of [
      line(0),
      line(1.5),
      line(MAX_LINE_CENTS + 1),
      line(-(MAX_LINE_CENTS + 1), "ADJUSTMENT"),
      line(-100),
    ]) {
      expect(invoiceDraftSchema.safeParse(bad).success).toBe(false);
    }
  });
  it("explains each problem in plain words", () => {
    const messages = (input: unknown) =>
      (invoiceDraftSchema.safeParse(input).error?.issues ?? []).map((i) => i.message);
    expect(messages(line(0))).toEqual([
      "Enter an amount that is not zero, up to R1 000 000 either way.",
    ]);
    expect(messages(line(1.5))).toEqual(["Enter the amount in whole cents."]);
    const withDescription = (description: string) => ({
      version: 1,
      dueDate: null,
      lines: [{ id: null, kind: "SERVICE", description, amountCents: 100 }],
    });
    expect(messages(withDescription("  "))).toEqual(["Enter a description."]);
    expect(messages(withDescription("x".repeat(301)))).toEqual(["Keep this under 300 characters."]);
    expect(messages(withDescription("Garden\u0000"))).toEqual(["Remove the special characters."]);
  });
  it("refuses the same line id twice (in any letter case)", () => {
    const row = (id: string) => ({ id, kind: "SERVICE", description: "Garden", amountCents: 100 });
    const result = invoiceDraftSchema.safeParse({
      version: 1,
      dueDate: null,
      lines: [row(ID1), row(ID2), row(ID1.toUpperCase())],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path)).toEqual([["lines", 2, "id"]]);
    expect(
      invoiceDraftSchema.safeParse({ version: 1, dueDate: null, lines: [row(ID1), row(ID2)] })
        .success,
    ).toBe(true);
  });
});

describe("paymentInputFromForm", () => {
  const today = "2026-11-27";
  it("reads the payment and its allocations, skipping empty ones", () => {
    const result = paymentInputFromForm(
      {
        payerCustomerId: ID1,
        receivedOn: "2026-11-26",
        amount: "2 300,00",
        reference: "  C-0123 ",
        note: "",
        reportId: "",
        [`alloc-${ID2}`]: "1150",
        "alloc-33333333-3333-4333-8333-333333333333": "",
      },
      today,
    );
    expect(result).toEqual({
      ok: true,
      input: {
        payerCustomerId: ID1,
        receivedOn: "2026-11-26",
        amountCents: 230000,
        reference: "C-0123",
        note: null,
        allocations: [{ invoiceId: ID2, amountCents: 115000 }],
        reportId: null,
      },
    });
  });

  it("refuses a future date, a zero amount and allocations above the payment", () => {
    expect(
      paymentInputFromForm(
        { payerCustomerId: ID1, receivedOn: "2026-11-28", amount: "0", reference: "", note: "" },
        today,
      ),
    ).toEqual({
      ok: false,
      fieldErrors: {
        receivedOn: "Choose the date the money arrived (not in the future).",
        amount: "Enter the amount received, for example 1150.00.",
      },
    });
    expect(
      paymentInputFromForm(
        {
          payerCustomerId: ID1,
          receivedOn: "2026-11-27",
          amount: "100",
          reference: "",
          note: "",
          [`alloc-${ID2}`]: "150",
        },
        today,
      ),
    ).toEqual({
      ok: false,
      fieldErrors: { amount: "The amounts allocated add up to more than the payment." },
    });
  });

  it("refuses a payment or an allocation above R1 000 000 and a date before 2020", () => {
    const base = { payerCustomerId: ID1, receivedOn: today, reference: "", note: "" };
    expect(paymentInputFromForm({ ...base, amount: "1000000.01" }, today)).toEqual({
      ok: false,
      fieldErrors: { amount: "Keep the payment to R1 000 000 or less." },
    });
    expect(
      paymentInputFromForm({ ...base, amount: "1000000", [`alloc-${ID2}`]: "1000000.01" }, today),
    ).toEqual({
      ok: false,
      fieldErrors: { [`alloc-${ID2}`]: "Keep the amount to R1 000 000 or less." },
    });
    expect(paymentInputFromForm({ ...base, amount: "10", [`alloc-${ID2}`]: "abc" }, today)).toEqual(
      { ok: false, fieldErrors: { [`alloc-${ID2}`]: "Enter an amount or leave the box empty." } },
    );
    expect(
      paymentInputFromForm({ ...base, receivedOn: "2019-12-31", amount: "10" }, today),
    ).toEqual({
      ok: false,
      fieldErrors: { receivedOn: "Choose the date the money arrived (not in the future)." },
    });
    const atLimit = paymentInputFromForm({ ...base, amount: "1000000" }, today);
    expect(atLimit.ok && atLimit.input.amountCents).toBe(100_000_000);
  });

  it("refuses control characters in the reference and note, but keeps line breaks in a note", () => {
    const base = { payerCustomerId: ID1, receivedOn: today, amount: "10" };
    expect(
      paymentInputFromForm({ ...base, reference: "C-01\u000023", note: "ok\u0007" }, today),
    ).toEqual({
      ok: false,
      fieldErrors: {
        reference: "Remove the special characters.",
        note: "Remove the special characters.",
      },
    });
    expect(paymentInputFromForm({ ...base, reference: "a\tb" }, today)).toEqual({
      ok: false,
      fieldErrors: { reference: "Remove the special characters." },
    });
    expect(paymentInputFromForm({ ...base, note: "x\u007f" }, today)).toEqual({
      ok: false,
      fieldErrors: { note: "Remove the special characters." },
    });
    const withBreaks = paymentInputFromForm(
      { ...base, note: "Line one\r\nLine two\nthree" },
      today,
    );
    expect(withBreaks.ok && withBreaks.input.note).toBe("Line one\r\nLine two\nthree");
  });

  it("refuses a damaged form", () => {
    expect(
      paymentInputFromForm({ payerCustomerId: "x", receivedOn: today, amount: "1" }, today),
    ).toEqual({
      ok: false,
      fieldErrors: { form: "Refresh the page and try again." },
    });
  });
});

describe("allocationFormSchema", () => {
  it("turns the amount into cents", () => {
    expect(allocationFormSchema.parse({ paymentId: ID1, invoiceId: ID2, amount: "1150" })).toEqual({
      paymentId: ID1,
      invoiceId: ID2,
      amountCents: 115000,
    });
  });
  it("refuses zero, an amount above R1 000 000 and a bad id", () => {
    for (const amount of ["0", "1000000.01", "-5", "abc"]) {
      expect(
        allocationFormSchema.safeParse({ paymentId: ID1, invoiceId: ID2, amount }).success,
      ).toBe(false);
    }
    expect(
      allocationFormSchema.safeParse({ paymentId: "x", invoiceId: ID2, amount: "1" }).success,
    ).toBe(false);
  });
  it("says the limit when the amount is too big", () => {
    const result = allocationFormSchema.safeParse({
      paymentId: ID1,
      invoiceId: ID2,
      amount: "1000000.01",
    });
    expect(result.error?.issues.map((i) => i.message)).toEqual([
      "Keep the amount to R1 000 000 or less.",
    ]);
  });
});

describe("reasonSchema", () => {
  it("trims, and refuses empty, too long and control characters", () => {
    expect(reasonSchema.parse("  Sent twice ")).toBe("Sent twice");
    expect(reasonSchema.safeParse("   ").success).toBe(false);
    expect(reasonSchema.safeParse("x".repeat(301)).success).toBe(false);
    expect(reasonSchema.safeParse("x".repeat(300)).success).toBe(true);
    const bad = reasonSchema.safeParse("bad\u0000reason");
    expect(bad.error?.issues.map((i) => i.message)).toEqual(["Remove the special characters."]);
  });
});

describe("invoice settings", () => {
  it("cleans the bank details and turns the late fee into cents", () => {
    const parsed = invoiceSettingsFormSchema.parse({
      bankName: " ZZ Test Bank ",
      accountHolder: "ACE Garden Services",
      accountNumber: "1234 5678-90",
      branchCode: "250655",
      accountType: "Business cheque",
      onceOffDueDays: "14",
      lateFee: "100",
    });
    expect(parsed).toEqual({
      bankName: "ZZ Test Bank",
      accountHolder: "ACE Garden Services",
      accountNumber: "1234567890",
      branchCode: "250655",
      accountType: "Business cheque",
      onceOffDueDays: 14,
      lateFeeCents: 10000,
    });
  });
  it("refuses a short account number, a bad branch code and too many days", () => {
    const result = invoiceSettingsFormSchema.safeParse({
      bankName: "",
      accountHolder: "",
      accountNumber: "123",
      branchCode: "25065",
      accountType: "",
      onceOffDueDays: "91",
      lateFee: "-1",
    });
    expect(result.success).toBe(false);
    const paths = (result.error?.issues ?? []).map((i) => String(i.path[0])).sort();
    expect(paths).toEqual(["accountNumber", "branchCode", "lateFee", "onceOffDueDays"]);
  });
  it("refuses control characters in the text boxes", () => {
    const result = invoiceSettingsFormSchema.safeParse({
      bankName: "ZZ\u0000 Bank",
      accountHolder: "ACE\u001b",
      accountNumber: "1234567890",
      branchCode: "250655",
      accountType: "Cheque\u007f",
      onceOffDueDays: "14",
      lateFee: "100",
    });
    const issues = (result.error?.issues ?? []).map((i) => [String(i.path[0]), i.message]);
    expect(issues.sort()).toEqual([
      ["accountHolder", "Remove the special characters."],
      ["accountType", "Remove the special characters."],
      ["bankName", "Remove the special characters."],
    ]);
  });
  it("knows when the bank details are complete", () => {
    const full = {
      bankName: "B",
      accountHolder: "H",
      accountNumber: "123456",
      branchCode: "250655",
    };
    expect(bankDetailsReady(full)).toBe(true);
    expect(bankDetailsReady({ ...full, branchCode: " " })).toBe(false);
  });
});
