import { describe, expect, it } from "vitest";
import {
  IMPORT_TEMPLATE,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  mapImportRow,
  parseCsvText,
  type RawImportRow,
} from "./csv";

const row = (over: Partial<RawImportRow> = {}): RawImportRow => ({
  type: "",
  display_name: "Test Person",
  company_name: "",
  contact_name: "",
  email: "test@example.com",
  phone: "",
  billing_line1: "",
  billing_suburb: "",
  billing_city: "",
  billing_postal_code: "",
  property_address: "",
  property_suburb: "",
  property_city: "",
  frequency: "",
  monthly_fee_rand: "",
  extras: "",
  source: "",
  notes: "",
  ...over,
});

describe("import limits", () => {
  it("are 2,000 rows and 2 MB", () => {
    expect(MAX_IMPORT_ROWS).toBe(2000);
    expect(MAX_IMPORT_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe("parseCsvText", () => {
  it("reads the template we hand out", () => {
    const result = parseCsvText(IMPORT_TEMPLATE);
    expect("rows" in result && result.rows.length).toBe(1);
  });
  it("handles a byte-order mark, quotes and semicolons", () => {
    const csv = '\uFEFFDisplay_Name;Email\n"Smith, J";j@example.com\n';
    const result = parseCsvText(csv);
    expect("rows" in result && result.rows[0]?.display_name).toBe("Smith, J");
    expect("rows" in result && result.rows[0]?.email).toBe("j@example.com");
  });
  it("keeps spreadsheet row numbers when blank rows are skipped", () => {
    const csv = "display_name,email\nA,a@example.com\n\nB,b@example.com\n,\nC,c@example.com\n\n,\n";
    const result = parseCsvText(csv);
    expect("rows" in result && result.rows.map((r) => r.display_name)).toEqual(["A", "B", "C"]);
    expect("lines" in result && result.lines).toEqual([2, 4, 6]);
  });
  it("counts a multi-line quoted cell as one row", () => {
    const csv = 'display_name,notes\nA,"line one\nline two"\nB,x\n';
    const result = parseCsvText(csv);
    expect("lines" in result && result.lines).toEqual([2, 3]);
  });
  it("says there are no rows when only blank rows follow the header", () => {
    expect("error" in parseCsvText("display_name,email\n\n,\n")).toBe(true);
  });
  it("needs a display_name column and at least one row", () => {
    expect("error" in parseCsvText("email\nx@example.com\n")).toBe(true);
    expect("error" in parseCsvText("display_name\n")).toBe(true);
  });
  it("refuses too many rows", () => {
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Person ${i}`).join("\n");
    expect("error" in parseCsvText(`display_name\n${body}`)).toBe(true);
  });
});

describe("mapImportRow", () => {
  it("maps a good row, defaulting the contact name to the customer name", () => {
    const r = mapImportRow(
      row({
        phone: "082 123 4567",
        property_address: "1 Test St",
        frequency: "Fortnightly",
        monthly_fee_rand: "R 850",
        type: "company",
      }),
      2,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.customer.type).toBe("COMPANY");
      expect(r.row.contact.name).toBe("Test Person");
      expect(r.row.contact.phone).toBe("+27821234567");
      expect(r.row.property?.frequency).toBe("FORTNIGHTLY");
      expect(r.row.property?.monthlyFee).toBe(85000);
    }
  });
  it("reports every problem with the line number", () => {
    const r = mapImportRow(
      row({ display_name: "", email: "nope", phone: "12", frequency: "daily", type: "alien" }),
      7,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.line).toBe(7);
      expect(r.errors.length).toBeGreaterThanOrEqual(4);
    }
  });
  it("needs an email or a phone", () => {
    const r = mapImportRow(row({ email: "", phone: "" }), 3);
    expect(r.ok).toBe(false);
  });
});
