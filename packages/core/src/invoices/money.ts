import { parseRandToCents } from "../customers/schemas";
import type { InvoiceDisplayStatus, InvoiceLineKindValue } from "./labels";

export const MAX_INVOICE_LINES = 40;
export const MAX_LINE_CENTS = 100_000_000; // R1 000 000
export const MAX_PAYMENT_CENTS = 100_000_000; // R1 000 000
export const MAX_DESCRIPTION = 300;

/** Like parseRandToCents, but a leading minus is allowed (adjustments). */
export function parseSignedRandToCents(input: string): number | null {
  const text = input.trim();
  const negative = text.startsWith("-");
  const cents = parseRandToCents(negative ? text.slice(1) : text);
  if (cents === null) return null;
  return negative ? -cents : cents;
}

export function sumLineCents(lines: readonly { amountCents: number }[]): number {
  return lines.reduce((total, l) => total + l.amountCents, 0);
}

/**
 * The status shown. Only DRAFT, ISSUED and VOID are stored; for an issued invoice the balance (total minus
 * allocations from payments that are not voided) and the due date decide the rest. Due today is not overdue.
 */
export function invoiceDisplayStatus(
  inv: {
    status: "DRAFT" | "ISSUED" | "VOID";
    totalCents: number;
    allocatedCents: number;
    dueDate: string | null;
  },
  today: string,
): InvoiceDisplayStatus {
  if (inv.status === "DRAFT") return "DRAFT";
  if (inv.status === "VOID") return "VOID";
  const balance = inv.totalCents - inv.allocatedCents;
  if (balance <= 0) return "PAID";
  if (inv.dueDate !== null && inv.dueDate < today) return "OVERDUE";
  return inv.allocatedCents > 0 ? "PART_PAID" : "UNPAID";
}

/** Oldest due first (then by reference), each up to its balance, until the money runs out. */
export function suggestAllocations(
  amountCents: number,
  invoices: readonly { id: string; balanceCents: number; dueDate: string; reference: string }[],
): { invoiceId: string; amountCents: number }[] {
  const ordered = [...invoices]
    .filter((i) => i.balanceCents > 0)
    .sort((a, b) =>
      a.dueDate === b.dueDate
        ? a.reference < b.reference
          ? -1
          : a.reference > b.reference
            ? 1
            : 0
        : a.dueDate < b.dueDate
          ? -1
          : 1,
    );
  const out: { invoiceId: string; amountCents: number }[] = [];
  let left = amountCents;
  for (const i of ordered) {
    if (left <= 0) break;
    const take = Math.min(left, i.balanceCents);
    out.push({ invoiceId: i.id, amountCents: take });
    left -= take;
  }
  return out;
}

/** What stops a draft being issued, in plain words. An empty list means it can be issued. */
export function issueProblems(
  input: {
    lines: readonly { kind: InvoiceLineKindValue; description: string; amountCents: number }[];
    dueDate: string;
  },
  today: string,
): string[] {
  const problems: string[] = [];
  if (input.lines.length === 0) problems.push("Add at least one line.");
  if (input.lines.length > MAX_INVOICE_LINES) {
    problems.push(`Keep the invoice to ${MAX_INVOICE_LINES} lines or fewer.`);
  }
  input.lines.forEach((line, index) => {
    const n = `Line ${index + 1}`;
    if (!line.description.trim()) problems.push(`${n} needs a description.`);
    if (line.amountCents === 0) problems.push(`${n} needs an amount.`);
    else if (line.amountCents < 0 && line.kind !== "ADJUSTMENT") {
      problems.push(`${n} cannot be negative. Only an adjustment can be.`);
    }
  });
  if (sumLineCents(input.lines) <= 0) problems.push("The total must be above zero.");
  if (input.dueDate < today) problems.push("The due date has passed. Change it before issuing.");
  return problems;
}

/** The billing address lines that are filled in, joined with ", ". Null when there are none. */
export function formatBillingAddress(c: {
  billingLine1: string | null;
  billingLine2: string | null;
  billingSuburb: string | null;
  billingCity: string | null;
  billingPostalCode: string | null;
}): string | null {
  const text = [c.billingLine1, c.billingLine2, c.billingSuburb, c.billingCity, c.billingPostalCode]
    .map((v) => (v ?? "").trim())
    .filter(Boolean)
    .join(", ");
  return text === "" ? null : text;
}

/** Cuts a description to the 300 characters the database allows. */
export function fitDescription(text: string): string {
  const t = text.trim();
  return t.length <= MAX_DESCRIPTION ? t : `${t.slice(0, MAX_DESCRIPTION - 3)}...`;
}
