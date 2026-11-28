import { describe, expect, it } from "vitest";
import { companyAddressInputFromForm, companyAddressSchema } from "./address";
import { BLANK_COMPANY_ADDRESS, formatCompanyAddress } from "./format";

const FULL = {
  line1: "1 ZZ Test Road",
  line2: "Unit 2",
  suburb: "Testville",
  city: "Testcity",
  postalCode: "0000",
};

describe("formatCompanyAddress", () => {
  it("joins the non-blank parts with commas on one line", () => {
    expect(formatCompanyAddress(FULL)).toBe("1 ZZ Test Road, Unit 2, Testville, Testcity, 0000");
    expect(formatCompanyAddress({ ...FULL, line2: "  ", postalCode: "" })).toBe(
      "1 ZZ Test Road, Testville, Testcity",
    );
  });
  it("is null when every part is blank", () => {
    expect(formatCompanyAddress(BLANK_COMPANY_ADDRESS)).toBeNull();
    expect(formatCompanyAddress({ ...BLANK_COMPANY_ADDRESS, city: "   " })).toBeNull();
  });
  it("never gives more than one line", () => {
    expect(formatCompanyAddress({ ...BLANK_COMPANY_ADDRESS, line1: "1 Road\r\n  Testville" })).toBe(
      "1 Road Testville",
    );
  });
});

describe("companyAddressSchema", () => {
  it("trims each part and allows a blank address", () => {
    expect(companyAddressSchema.parse({ ...FULL, line1: "  1 ZZ Test Road  " })).toEqual(FULL);
    expect(companyAddressSchema.parse(BLANK_COMPANY_ADDRESS)).toEqual(BLANK_COMPANY_ADDRESS);
    expect(companyAddressSchema.parse({})).toEqual(BLANK_COMPANY_ADDRESS);
  });
  it("refuses control characters", () => {
    for (const bad of ["a\u0000b", "a\nb", "a\tb", "a\u007fb"]) {
      const result = companyAddressSchema.safeParse({ ...FULL, line1: bad });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("Remove the special characters.");
    }
  });
  it("keeps each line to 120 characters and the postal code to 12", () => {
    expect(companyAddressSchema.safeParse({ ...FULL, city: "x".repeat(120) }).success).toBe(true);
    expect(companyAddressSchema.safeParse({ ...FULL, city: "x".repeat(121) }).success).toBe(false);
    expect(companyAddressSchema.safeParse({ ...FULL, postalCode: "1".repeat(12) }).success).toBe(
      true,
    );
    const long = companyAddressSchema.safeParse({ ...FULL, postalCode: "1".repeat(13) });
    expect(long.error?.issues[0]?.message).toBe("Keep this under 12 characters.");
  });
});

describe("companyAddressInputFromForm", () => {
  it("reads the five fields from form values or FormData", () => {
    expect(companyAddressInputFromForm({ ...FULL, extra: "ignored" })).toEqual({
      ok: true,
      input: FULL,
    });
    const form = new FormData();
    form.set("line1", " 1 ZZ Test Road ");
    form.set("city", "Testcity");
    expect(companyAddressInputFromForm(form)).toEqual({
      ok: true,
      input: { ...BLANK_COMPANY_ADDRESS, line1: "1 ZZ Test Road", city: "Testcity" },
    });
  });
  it("gives a plain message per field", () => {
    expect(
      companyAddressInputFromForm({ ...FULL, suburb: "a\u0000", postalCode: "1".repeat(13) }),
    ).toEqual({
      ok: false,
      fieldErrors: {
        suburb: "Remove the special characters.",
        postalCode: "Keep this under 12 characters.",
      },
    });
  });
});
