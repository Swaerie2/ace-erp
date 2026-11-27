import { describe, expect, it } from "vitest";
import {
  formatInvoiceReference,
  invoicePdfFilename,
  parseInvoiceSearch,
  statementPdfFilename,
} from "./reference";

describe("invoice references", () => {
  it("formats INV-year-four digits, null for a draft", () => {
    expect(formatInvoiceReference({ numberYear: 2026, numberSeq: 1 })).toBe("INV-2026-0001");
    expect(formatInvoiceReference({ numberYear: 2026, numberSeq: 12345 })).toBe("INV-2026-12345");
    expect(formatInvoiceReference({ numberYear: null, numberSeq: null })).toBeNull();
  });
  it("reads a typed reference for searching", () => {
    expect(parseInvoiceSearch("INV-2026-0104")).toEqual({ numberYear: 2026, numberSeq: 104 });
    expect(parseInvoiceSearch("inv-2026-104")).toEqual({ numberYear: 2026, numberSeq: 104 });
    expect(parseInvoiceSearch("104")).toEqual({ numberSeq: 104 });
    expect(parseInvoiceSearch("Smith")).toBeNull();
  });
  it("makes safe file names", () => {
    expect(invoicePdfFilename("INV-2026-0001")).toBe("INV-2026-0001.pdf");
    expect(invoicePdfFilename("Draft")).toBe("Draft.pdf");
    expect(invoicePdfFilename('a b/"c')).toBe("a-b--c.pdf");
    expect(statementPdfFilename("C-0123", "2026-11-30")).toBe("Statement-C-0123-2026-11-30.pdf");
  });
});
