import { describe, expect, it } from "vitest";
import {
  buildInvoiceDocument,
  buildStatementDocument,
  type InvoiceDocumentInput,
} from "./document";
import type { InvoiceSnapshot } from "./schemas";

const snapshot: InvoiceSnapshot = {
  bank: {
    bankName: "ZZ Test Bank",
    accountHolder: "ACE Garden Services",
    accountNumber: "1234567890",
    branchCode: "250655",
    accountType: "Business cheque",
  },
  business: {
    legalName: "ZZ Legal (Pty) Ltd",
    tradingName: "ACE Garden Services",
    registrationNumber: "2026/000000/07",
    phone: "000 000 0000",
    email: "info@example.com",
    website: "www.example.com",
  },
  paymentReference: "C-0123",
};

const base: InvoiceDocumentInput = {
  reference: "INV-2026-0007",
  status: "PART_PAID",
  kind: "MONTHLY",
  issuedOn: "2026-11-20",
  dueOn: "2026-11-30",
  serviceMonth: "2026-12",
  billTo: { name: "ZZ E2E Agency", address: "1 Test Road, Testville" },
  forCustomerName: "ZZ E2E Complex A",
  lines: [
    {
      id: "1",
      kind: "SERVICE",
      description: "Main: Weekly garden maintenance",
      amountCents: 115000,
    },
    { id: "2", kind: "ADJUSTMENT", description: "Discount", amountCents: -15000 },
  ],
  paidCents: 40000,
  snapshot,
};

describe("buildInvoiceDocument", () => {
  it("formats everything the screen and the PDF show", () => {
    const doc = buildInvoiceDocument(base);
    expect(doc).toMatchObject({
      reference: "INV-2026-0007",
      statusLabel: "Part paid",
      banner: null,
      title: "Monthly invoice",
      serviceMonthLabel: "December 2026",
      forCustomerName: "ZZ E2E Complex A",
      totalLabel: "R1,000.00",
      paidLabel: "R400.00",
      balanceLabel: "R600.00",
      bankReady: true,
      paymentReference: "C-0123",
      vatNote: "ACE Garden Services is not VAT registered, no VAT is charged.",
    });
    expect(doc.issuedDate).toMatch(/20\sNov\s2026/);
    expect(doc.dueDate).toMatch(/30\sNov\s2026/);
    expect(doc.rows.map((r) => [r.kindLabel, r.amountLabel])).toEqual([
      ["Service", "R1,150.00"],
      ["Adjustment", "-R150.00"],
    ]);
  });
  it("shows the draft, void and paid banners, and no balance on a draft", () => {
    const draft = buildInvoiceDocument({
      ...base,
      reference: null,
      status: "DRAFT",
      issuedOn: null,
      paidCents: 0,
    });
    expect(draft).toMatchObject({
      reference: "Draft",
      banner: "Draft: not yet issued.",
      paidLabel: null,
      balanceLabel: null,
    });
    expect(buildInvoiceDocument({ ...base, status: "VOID" }).banner).toBe(
      "This invoice has been voided. Nothing is owed on it.",
    );
    expect(buildInvoiceDocument({ ...base, status: "PAID", paidCents: 100000 })).toMatchObject({
      banner: "Paid in full. Thank you.",
      balanceLabel: "R0.00",
    });
    expect(
      buildInvoiceDocument({
        ...base,
        snapshot: { ...snapshot, bank: { ...snapshot.bank, accountNumber: "" } },
      }).bankReady,
    ).toBe(false);
  });
  it("shows no paid or balance on a void invoice, even if money was once allocated", () => {
    expect(buildInvoiceDocument({ ...base, status: "VOID", paidCents: 40000 })).toMatchObject({
      paidLabel: null,
      balanceLabel: null,
    });
  });
  it("contains no em dash anywhere", () => {
    expect(JSON.stringify(buildInvoiceDocument(base))).not.toContain("\u2014");
  });
});

const statementData = {
  from: "2026-11-01",
  to: "2026-11-30",
  openingCents: 0,
  invoicedCents: 80000,
  paidCents: 100000,
  closingCents: -20000,
  creditCents: 20000,
  entries: [
    {
      id: "i",
      date: "2026-11-20",
      kind: "INVOICE" as const,
      label: "Invoice INV-2026-0001",
      customerName: "ZZ A",
      debitCents: 80000,
      creditCents: 0,
      balanceCents: 80000,
      allocations: [],
    },
    {
      id: "p",
      date: "2026-11-21",
      kind: "PAYMENT" as const,
      label: "Payment received, ref ZZ EFT",
      customerName: null,
      debitCents: 0,
      creditCents: 100000,
      balanceCents: -20000,
      allocations: [
        { invoiceId: "i", reference: "INV-2026-0001", amountCents: 80000 },
        { invoiceId: "j", reference: "INV-2026-0002", amountCents: 0 },
      ],
    },
  ],
  outstanding: [],
  byComplex: [{ customerId: "a", customerName: "ZZ A", invoicedCents: 80000, outstandingCents: 0 }],
};

describe("buildStatementDocument", () => {
  const build = () =>
    buildStatementDocument({
      generatedOn: "2026-11-27",
      customer: { name: "ZZ E2E Agency", number: 123, address: null },
      snapshot,
      data: statementData,
    });

  it("labels the summary, the rows and the per-complex breakdown", () => {
    const doc = build();
    expect(doc.customer.number).toBe("C-0123");
    expect(doc.summary).toEqual({
      opening: "R0.00",
      invoiced: "R800.00",
      paid: "R1,000.00",
      closing: "R200.00",
      closingNote: "In credit",
      credit: "R200.00",
    });
    expect(doc.rows.map((r) => [r.debit, r.credit, r.balance])).toEqual([
      ["R800.00", "", "R800.00"],
      ["", "R1,000.00", "-R200.00"],
    ]);
    expect(doc.byComplex).toEqual([{ name: "ZZ A", invoiced: "R800.00", outstanding: "R0.00" }]);
    expect(doc.periodLabel).toMatch(/1\sNov\s2026 to 30\sNov\s2026/);
  });
  it("says which invoices a payment settled, in its description", () => {
    const [invoiceRow, paymentRow] = build().rows;
    expect(invoiceRow?.description).toBe("Invoice INV-2026-0001");
    expect(paymentRow?.description).toBe(
      "Payment received, ref ZZ EFT (applied to INV-2026-0001, INV-2026-0002)",
    );
  });
  it("labels amount due, nothing owed and the outstanding rows", () => {
    const due = buildStatementDocument({
      generatedOn: "2026-11-27",
      customer: { name: "ZZ E2E Agency", number: 123, address: "1 Test Road" },
      snapshot,
      data: {
        ...statementData,
        closingCents: 5000,
        creditCents: 0,
        outstanding: [
          {
            id: "o",
            reference: "INV-2026-0001",
            customerName: "ZZ A",
            dueOn: "2026-11-25",
            balanceCents: 5000,
            overdue: true,
          },
        ],
      },
    });
    expect(due.summary).toMatchObject({
      closing: "R50.00",
      closingNote: "Amount due",
      credit: null,
    });
    expect(due.outstanding).toEqual([
      {
        id: "o",
        reference: "INV-2026-0001",
        forName: "ZZ A",
        dueDate: expect.stringMatching(/25\sNov\s2026/),
        balance: "R50.00",
        overdue: true,
      },
    ]);
    expect(
      buildStatementDocument({
        generatedOn: "2026-11-27",
        customer: { name: "x", number: 1, address: null },
        snapshot,
        data: { ...statementData, closingCents: 0, creditCents: 0 },
      }).summary.closingNote,
    ).toBe("Nothing owed");
  });
  it("contains no em dash anywhere", () => {
    expect(JSON.stringify(build())).not.toContain("\u2014");
  });
});
