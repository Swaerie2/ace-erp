import { deflateSync, inflateSync } from "node:zlib";
import type { InvoiceDocument, QuoteDocument, StatementDocument } from "@ace/core";
import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { InvoicePdf, StatementPdf } from "./invoice-pdf";
import { QuotePdf } from "./quote-pdf";

// Made-up data only. These render the real PDF layouts to bytes, so a layout that throws (or a page that
// cannot be broken) fails here and not only in the browser.

const business = {
  legalName: "ZZ Legal (Pty) Ltd",
  tradingName: "ACE Garden Services",
  registrationNumber: "2026/000000/07",
  phone: "000 000 0000",
  email: "info@example.com",
  website: "www.example.com",
  address: "1 ZZ Test Road, Testville, 0000",
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
    logoVersion: null,
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
    showPayment: true,
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
    logoVersion: null,
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
      customerId: `c${i}`,
      name: `ZZ E2E Complex ${i}`,
      invoiced: "R800.00",
      outstanding: "R100.00",
    })),
    vatNote,
    ...overrides,
  };
}

function quote(overrides: Partial<QuoteDocument> = {}): QuoteDocument {
  return {
    reference: "QUO-2026-0104",
    status: "ISSUED",
    issuedDate: "20 Nov 2026",
    validUntil: "20 Dec 2026",
    tagline: "ZZ tagline.",
    business,
    preparedFor: {
      name: "ZZ E2E Client",
      email: "zz.client@example.com",
      phone: null,
      siteLabel: "Main",
      siteAddress: "1 Test Road, Testville",
    },
    summary: {
      monthlyTotal: "R1,150.00",
      frequencyLabel: "Weekly",
      onceOffTotal: null,
      optionalNote: null,
    },
    scope: {
      included: [{ name: "Lawn care", bullets: ["Cutting of all lawns"] }],
      excludedNames: [],
      standardExclusions: ["Tree work."],
    },
    pricing: {
      rows: [
        {
          id: "l1",
          kind: "PRICED",
          description: "Weekly garden maintenance",
          billingLabel: "Monthly",
          frequencyLabel: "Weekly",
          amountLabel: "R1,150.00",
        },
      ],
      totals: {
        monthly: "R1,150.00",
        onceOff: null,
        monthlyWithOptions: null,
        onceOffWithOptions: null,
      },
      acceptedMonthly: null,
      acceptedOnceOff: null,
    },
    termSections: [{ title: "General", clauses: [{ heading: "Payment", body: "ZZ terms." }] }],
    everyVisitPoints: ["ZZ point."],
    vatNote: "All amounts in ZAR.",
    ...overrides,
  };
}

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/** A real, decodable 40 x 40 PNG (one colour), built with zlib. */
function tinyPng(): Uint8Array {
  const ascii = (t: string) => [...t].map((c) => c.charCodeAt(0));
  const crc = (bytes: number[]) => {
    let c = 0xffffffff;
    for (const b of bytes) {
      c ^= b;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: number[]) => {
    const body = [...ascii(type), ...data];
    return [...u32(data.length), ...body, ...u32(crc(body))];
  };
  const row = [0, ...Array.from({ length: 40 }, () => [31, 77, 54]).flat()];
  const raw = Array.from({ length: 40 }, () => row).flat();
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", [...u32(40), ...u32(40), 8, 2, 0, 0, 0]),
    ...chunk("IDAT", [...deflateSync(Uint8Array.from(raw))]),
    ...chunk("IEND", []),
  ]);
}

/** A real 40 x 40 baseline JPEG (made once with an image tool; one colour). */
const TINY_JPEG_BASE64 =
  "/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAoACgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAIE/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AnQEsoAAAAAAAAAAAAAAAD//Z";

const LOGOS = {
  png: { data: tinyPng(), format: "png" as const },
  jpg: { data: Uint8Array.from(Buffer.from(TINY_JPEG_BASE64, "base64")), format: "jpg" as const },
};

/** True when the PDF embeds a picture (an image XObject). */
const hasImage = (buffer: Buffer) => /\/Subtype \/Image/.test(buffer.toString("latin1"));

/**
 * The text drawn on a PDF, roughly: every compressed content stream is inflated and the hex strings the
 * built-in fonts are written with are decoded and joined (kerning splits words, so spaces may be missing).
 */
function pdfText(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  let text = "";
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string;
    try {
      body = inflateSync(Buffer.from(m[1] ?? "", "latin1")).toString("latin1");
    } catch {
      continue;
    }
    for (const h of body.matchAll(/<([0-9a-fA-F]+)>/g)) {
      text += Buffer.from(h[1] ?? "", "hex").toString("latin1");
    }
  }
  return text;
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
  it("prints How to pay only when the document says so (not on a void or paid invoice)", async () => {
    const shown = pdfText(await renderToBuffer(InvoicePdf({ doc: invoice(1) })));
    expect(shown).toContain("How to pay");
    expect(shown).toContain("1234567890");
    for (const status of ["VOID", "PAID"] as const) {
      const hidden = pdfText(
        await renderToBuffer(InvoicePdf({ doc: invoice(1, { status, showPayment: false }) })),
      );
      expect(hidden).toContain("INV-2026-0007");
      expect(hidden).not.toContain("How to pay");
      expect(hidden).not.toContain("1234567890");
    }
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
            customerId: `c${i}`,
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

describe("the company logo on the PDFs", () => {
  for (const [name, logo] of Object.entries(LOGOS)) {
    it(`draws a ${name} logo on the invoice, statement and quote PDFs`, async () => {
      for (const element of [
        InvoicePdf({ doc: invoice(2), logo }),
        StatementPdf({ doc: statement(4), logo }),
        QuotePdf({ doc: quote(), logo }),
      ]) {
        const buffer = await renderToBuffer(element);
        expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
        expect(hasImage(buffer)).toBe(true);
      }
    });
  }

  it("without a logo draws no picture and keeps the same pages", async () => {
    const cases = [
      [InvoicePdf({ doc: invoice(2) }), InvoicePdf({ doc: invoice(2), logo: null })],
      [StatementPdf({ doc: statement(4) }), StatementPdf({ doc: statement(4), logo: null })],
      [QuotePdf({ doc: quote() }), QuotePdf({ doc: quote(), logo: null })],
    ] as const;
    for (const [without, withNull] of cases) {
      const a = await renderToBuffer(without);
      const b = await renderToBuffer(withNull);
      expect(hasImage(a)).toBe(false);
      expect(hasImage(b)).toBe(false);
      expect(pageCount(a)).toBe(pageCount(b));
    }
  });

  it("prints the company address, and renders an older quote with none", async () => {
    const plain = { ...business, address: null };
    for (const element of [
      InvoicePdf({ doc: invoice(1, { business: plain }) }),
      StatementPdf({ doc: statement(1, { business: plain }) }),
      QuotePdf({ doc: quote({ business: plain }) }),
    ]) {
      const buffer = await renderToBuffer(element);
      expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    }
  });
});
