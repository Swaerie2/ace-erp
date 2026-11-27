import { z } from "zod";
import { parseRandToCents } from "../customers/schemas";
import { isValidDateString } from "../quotes/reference";
import { isMonthString } from "./dates";
import { BILLING_TIMINGS, INVOICE_LINE_KINDS } from "./labels";
import {
  MAX_DESCRIPTION,
  MAX_INVOICE_LINES,
  MAX_LINE_CENTS,
  MAX_PAYMENT_CENTS,
  parseSignedRandToCents,
} from "./money";

export type FormParse<T> =
  { ok: true; input: T } | { ok: false; fieldErrors: Record<string, string> };
const DAMAGED = { ok: false as const, fieldErrors: { form: "Refresh the page and try again." } };
const isUuid = (v: string) => z.uuid().safeParse(v).success;
const tooLong = (max: number) => `Keep this under ${max} characters.`;

export const billingTimingSchema = z.enum(BILLING_TIMINGS);
export const runMonthSchema = z.string().refine(isMonthString, "Choose a month.");
export const reasonSchema = z
  .string()
  .trim()
  .min(1, "Say why in a few words.")
  .max(300, "Keep the reason to 300 characters or fewer.");

// --- settings ---------------------------------------------------------------------------------

export const invoiceSettingsFormSchema = z
  .object({
    bankName: z.string().trim().max(80, tooLong(80)),
    accountHolder: z.string().trim().max(120, tooLong(120)),
    accountNumber: z
      .string()
      .transform((v) => v.replace(/[\s-]/g, ""))
      .refine(
        (v) => v === "" || /^\d{6,16}$/.test(v),
        "Enter the account number as 6 to 16 digits.",
      ),
    branchCode: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{6}$/.test(v), "Enter the 6-digit branch code."),
    accountType: z.string().trim().max(40, tooLong(40)),
    onceOffDueDays: z
      .string()
      .trim()
      .refine(
        (v) => /^\d{1,2}$/.test(v) && Number(v) <= 90,
        "Enter a whole number of days from 0 to 90.",
      )
      .transform(Number),
    lateFee: z.string().transform((v, ctx) => {
      const cents = v.trim() === "" ? 0 : parseRandToCents(v);
      if (cents === null || cents > 1_000_000) {
        ctx.addIssue({
          code: "custom",
          message: "Enter an amount from 0 to 10000, for example 100.",
        });
        return z.NEVER;
      }
      return cents;
    }),
  })
  .transform(({ lateFee, ...rest }) => ({ ...rest, lateFeeCents: lateFee }));
export type InvoiceSettingsInput = z.output<typeof invoiceSettingsFormSchema>;

/** Issuing needs at least these four. */
export function bankDetailsReady(s: {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  branchCode: string;
}): boolean {
  return [s.bankName, s.accountHolder, s.accountNumber, s.branchCode].every((v) => v.trim() !== "");
}

export const invoiceSnapshotSchema = z.object({
  bank: z.object({
    bankName: z.string(),
    accountHolder: z.string(),
    accountNumber: z.string(),
    branchCode: z.string(),
    accountType: z.string(),
  }),
  business: z.object({
    legalName: z.string(),
    tradingName: z.string(),
    registrationNumber: z.string(),
    phone: z.string(),
    email: z.string(),
    website: z.string(),
  }),
  paymentReference: z.string(),
});
export type InvoiceSnapshot = z.output<typeof invoiceSnapshotSchema>;

// --- drafts -----------------------------------------------------------------------------------

export const invoiceDraftSchema = z.object({
  version: z.number().int().min(1),
  dueDate: z.string().refine(isValidDateString, "Choose a valid date.").nullable(),
  lines: z
    .array(
      z
        .object({
          id: z.uuid().nullable(),
          kind: z.enum(INVOICE_LINE_KINDS),
          description: z.string().trim().min(1).max(MAX_DESCRIPTION),
          amountCents: z
            .number()
            .int()
            .refine((v) => v !== 0 && Math.abs(v) <= MAX_LINE_CENTS),
        })
        .refine((l) => l.amountCents > 0 || l.kind === "ADJUSTMENT", {
          message: "Only an adjustment can be negative.",
          path: ["amountCents"],
        }),
    )
    .max(MAX_INVOICE_LINES),
});
export type InvoiceDraftInput = z.output<typeof invoiceDraftSchema>;

/**
 * The draft form posts rows `line-<i>-id`, `-kind`, `-description`, `-amount` and `-remove` (a tick box).
 * A row with no id, no description and no amount is an unused empty row and is skipped.
 */
export function draftInputFromForm(values: Record<string, string>): FormParse<InvoiceDraftInput> {
  const version = Number(values.version);
  if (!/^\d+$/.test(values.version ?? "") || !Number.isSafeInteger(version) || version < 1) {
    return DAMAGED;
  }
  const fieldErrors: Record<string, string> = {};
  const dueText = (values.dueDate ?? "").trim();
  if (dueText !== "" && !isValidDateString(dueText)) fieldErrors.dueDate = "Choose a valid date.";

  const lines: InvoiceDraftInput["lines"] = [];
  for (let i = 0; i < MAX_INVOICE_LINES; i += 1) {
    const p = `line-${i}-`;
    const id = (values[`${p}id`] ?? "").trim();
    const description = (values[`${p}description`] ?? "").trim();
    const amountText = (values[`${p}amount`] ?? "").trim();
    if (values[`${p}remove`] === "on") continue;
    if (id === "" && description === "" && amountText === "") continue;
    if (id !== "" && !isUuid(id)) return DAMAGED;
    const kind = INVOICE_LINE_KINDS.find((k) => k === values[`${p}kind`]);
    if (!kind) {
      fieldErrors[`${p}kind`] = "Choose what kind of line this is.";
      continue;
    }
    if (description === "") fieldErrors[`${p}description`] = "Enter a description.";
    else if (description.length > MAX_DESCRIPTION)
      fieldErrors[`${p}description`] = tooLong(MAX_DESCRIPTION);
    const cents = parseSignedRandToCents(amountText);
    if (cents === null || cents === 0) {
      fieldErrors[`${p}amount`] = "Enter an amount, for example 1150 or -100.";
    } else if (Math.abs(cents) > MAX_LINE_CENTS) {
      fieldErrors[`${p}amount`] = "Keep each line to R1 000 000 or less.";
    } else if (cents < 0 && kind !== "ADJUSTMENT") {
      fieldErrors[`${p}amount`] = "Only an adjustment can be negative.";
    }
    lines.push({ id: id === "" ? null : id, kind, description, amountCents: cents ?? 0 });
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, input: { version, dueDate: dueText === "" ? null : dueText, lines } };
}

// --- payments ---------------------------------------------------------------------------------

export const EARLIEST_PAYMENT_DATE = "2020-01-01";
export const MAX_REFERENCE = 100;
export const MAX_NOTE = 500;

export type PaymentInput = {
  payerCustomerId: string;
  receivedOn: string;
  amountCents: number;
  reference: string | null;
  note: string | null;
  allocations: { invoiceId: string; amountCents: number }[];
  reportId: string | null;
};

/** The record-payment form: payer, date, amount, reference, note, an optional report id and `alloc-<invoiceId>` boxes. */
export function paymentInputFromForm(
  values: Record<string, string>,
  today: string,
): FormParse<PaymentInput> {
  const payerCustomerId = (values.payerCustomerId ?? "").trim();
  const reportText = (values.reportId ?? "").trim();
  if (!isUuid(payerCustomerId) || (reportText !== "" && !isUuid(reportText))) return DAMAGED;
  const fieldErrors: Record<string, string> = {};

  const receivedOn = (values.receivedOn ?? "").trim();
  if (!isValidDateString(receivedOn) || receivedOn < EARLIEST_PAYMENT_DATE || receivedOn > today) {
    fieldErrors.receivedOn = "Choose the date the money arrived (not in the future).";
  }
  const amountCents = parseRandToCents(values.amount ?? "");
  if (amountCents === null || amountCents <= 0 || amountCents > MAX_PAYMENT_CENTS) {
    fieldErrors.amount = "Enter the amount received, for example 1150.00.";
  }
  const reference = (values.reference ?? "").trim();
  if (reference.length > MAX_REFERENCE) fieldErrors.reference = tooLong(MAX_REFERENCE);
  const note = (values.note ?? "").trim();
  if (note.length > MAX_NOTE) fieldErrors.note = tooLong(MAX_NOTE);

  const allocations: PaymentInput["allocations"] = [];
  for (const [key, raw] of Object.entries(values)) {
    if (!key.startsWith("alloc-")) continue;
    const invoiceId = key.slice("alloc-".length);
    if (!isUuid(invoiceId)) return DAMAGED;
    const text = raw.trim();
    if (text === "") continue;
    const cents = parseRandToCents(text);
    if (cents === null || cents > MAX_PAYMENT_CENTS) {
      fieldErrors[key] = "Enter an amount or leave the box empty.";
      continue;
    }
    if (cents > 0) allocations.push({ invoiceId, amountCents: cents });
  }
  if (
    fieldErrors.amount === undefined &&
    amountCents !== null &&
    allocations.reduce((t, a) => t + a.amountCents, 0) > amountCents
  ) {
    fieldErrors.amount = "The amounts allocated add up to more than the payment.";
  }
  if (Object.keys(fieldErrors).length > 0 || amountCents === null)
    return { ok: false, fieldErrors };
  return {
    ok: true,
    input: {
      payerCustomerId,
      receivedOn,
      amountCents,
      reference: reference === "" ? null : reference,
      note: note === "" ? null : note,
      allocations,
      reportId: reportText === "" ? null : reportText,
    },
  };
}

export const allocationFormSchema = z
  .object({
    paymentId: z.uuid(),
    invoiceId: z.uuid(),
    amount: z.string().transform((v, ctx) => {
      const cents = parseRandToCents(v);
      if (cents === null || cents <= 0 || cents > MAX_PAYMENT_CENTS) {
        ctx.addIssue({ code: "custom", message: "Enter an amount above zero." });
        return z.NEVER;
      }
      return cents;
    }),
  })
  .transform(({ amount, ...rest }) => ({ ...rest, amountCents: amount }));
