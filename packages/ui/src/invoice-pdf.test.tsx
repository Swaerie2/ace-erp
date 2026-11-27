import type { InvoiceDocument, StatementDocument } from "@ace/core";
import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { InvoicePdf, StatementPdf } from "./invoice-pdf";

// Made-up data only. These render the real PDF layouts to bytes, so a layout that throws (or a page that
// cannot be broken) fails here and not only in the browser.

const business = {
  legalName: "ZZ Legal (Pty) Ltd",
  tradingName: "ACE Garden Services",
  registrationNumber: "2026/000000/07",
  phone: "000 000 0000",
  email: "info@example.com",
  website: "www.example.com",
};
const bank = {
  bankName: "ZZ Test Bank",
  accountHolder: "ACE Garden Services",
  accountNumber: "1234567890",
  branchCode: "250655",
  accountType: "Business cheque",
};
const vatNote = "ACE Garden Services is not VAT registered, no VAT is charged.";

function invoice(rowCount: number, overrides: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    reference: "INV-2026-0007",
    status: "PART_PAID",
    statusLabel: "Part paid",
    banner: null,
    title: "Monthly invoice",
    issuedDate: "20 Nov 2026",
    dueDate: "30 Nov 2026",
    serviceMonthLabel: "December 2026",
    billTo: { name: "ZZ E2E Agency", address: "1 Test Road, Testville" },
    forCustomerName: "ZZ E2E Complex A",
    business,
    rows: Array.from({ length: rowCount }, (_, i) => ({
      id: String(i),
      description: `Main: Weekly garden maintenance, visit ${i + 1}, including lawn, edges and beds`,
      kindLabel: "Service",
      amountLabel: "R1,150.00",
    })),
    totalLabel: "R34,500.00",
    paidLabel: "R400.00",
    balanceLabel: "R34,100.00",
    bank,
    bankReady: true,
    paymentReference: "C-0123",
    vatNote,
    ...overrides,
  };
}

function statement(
  rowCount: number,
  overrides: Partial<StatementDocument> = {},
): StatementDocument {
  return {
    periodLabel: "1 Sep 2026 to 30 Nov 2026",
    generatedDate: "27 Nov 2026",
    customer: { name: "ZZ E2E Agency", number: "C-0123", address: "1 Test Road, Testville" },
    business,
    bank,
    bankReady: true,
    paymentReference: "C-0123",
    summary: {
      opening: "R0.00",
      invoiced: "R80,000.00",
      paid: "R70,000.00",
      closing: "R10,000.00",
      closingNote: "Amount due",
      credit: "R200.00",
    },
    rows: Array.from({ length: rowCount }, (_, i) => ({
      key: `row-${i}`,
      date: "20 Nov 2026",
      description:
        i % 2 === 0
          ? `Invoice INV-2026-${String(i).padStart(4, "0")}`
          : "Payment received, ref ZZ EFT (applied to INV-2026-0001, INV-2026-0002)",
      forName: i % 2 === 0 ? `ZZ E2E Complex ${i}` : null,
      debit: i % 2 === 0 ? "R800.00" : "",
      credit: i % 2 === 0 ? "" : "R1,000.00",
      balance: "R800.00",
    })),
    outstanding: Array.from({ length: Math.min(rowCount, 12) }, (_, i) => ({
      id: `o${i}`,
      reference: `INV-2026-${String(i).padStart(4, "0")}`,
      forName: `ZZ E2E Complex ${i}`,
      dueDate: "30 Nov 2026",
      balance: "R800.00",
      overdue: i % 3 === 0,
    })),
    byComplex: Array.from({ length: 5 }, (_, i) => ({
      name: `ZZ E2E Complex ${i}`,
      invoiced: "R800.00",
      outstanding: "R100.00",
    })),
    vatNote,
    ...overrides,
  };
}

/** Counts the pages of a PDF by its page objects. */
function pageCount(buffer: Buffer): number {
  return buffer.toString("latin1").match(/\/Type \/Page\b(?!s)/g)?.length ?? 0;
}

describe("InvoicePdf", () => {
  it("renders a normal invoice to a one page PDF", async () => {
    const buffer = await renderToBuffer(InvoicePdf({ doc: invoice(2) }));
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(pageCount(buffer)).toBe(1);
  });
  it("renders a draft with no bank details, no dates and a banner", async () => {
    const buffer = await renderToBuffer(
      InvoicePdf({
        doc: invoice(1, {
          reference: "Draft",
          status: "DRAFT",
          banner: "Draft: not yet issued.",
          issuedDate: null,
          dueDate: null,
          serviceMonthLabel: null,
          forCustomerName: null,
          billTo: { name: "ZZ E2E Agency", address: null },
          paidLabel: null,
          balanceLabel: null,
          bankReady: false,
        }),
      }),
    );
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
  it("wraps 30 lines across pages without throwing", async () => {
    const buffer = await renderToBuffer(InvoicePdf({ doc: invoice(30) }));
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(pageCount(buffer)).toBeGreaterThanOrEqual(2);
  });
});

describe("StatementPdf", () => {
  it("renders a normal statement to a PDF of at most two pages", async () => {
    const buffer = await renderToBuffer(StatementPdf({ doc: statement(4) }));
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(pageCount(buffer)).toBeLessThanOrEqual(2);
  });
  it("renders an empty statement for an ordinary customer", async () => {
    const buffer = await renderToBuffer(
      StatementPdf({
        doc: statement(0, {
          rows: [],
          outstanding: [],
          byComplex: [],
          summary: {
            opening: "R0.00",
            invoiced: "R0.00",
            paid: "R0.00",
            closing: "R0.00",
            closingNote: "Nothing owed",
            credit: null,
          },
          bankReady: false,
        }),
      }),
    );
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
  it("wraps 60 rows and a long per-complex list across pages without throwing", async () => {
    const buffer = await renderToBuffer(
      StatementPdf({
        doc: statement(65, {
          byComplex: Array.from({ length: 80 }, (_, i) => ({
            name: `ZZ E2E Complex ${i}`,
            invoiced: "R800.00",
            outstanding: "R100.00",
          })),
        }),
      }),
    );
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(pageCount(buffer)).toBeGreaterThanOrEqual(3);
  });
});
