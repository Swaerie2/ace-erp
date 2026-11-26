import { describe, expect, it } from "vitest";
import { welcomeSchema } from "./welcome-schema";

const base = {
  contactId: "11111111-1111-4111-8111-111111111111",
  name: " ZZ Person ",
  phone: "082 123 4567",
  billingLine1: "1 ZZ Road",
  billingLine2: "",
  billingSuburb: "ZZ Suburb",
  billingCity: "",
  billingPostalCode: "7441",
  consent: "on",
};

describe("welcomeSchema", () => {
  it("trims, normalises the phone and turns blanks into null", () => {
    expect(welcomeSchema.parse(base)).toEqual({
      contactId: base.contactId,
      name: "ZZ Person",
      phone: "+27821234567",
      billingLine1: "1 ZZ Road",
      billingLine2: null,
      billingSuburb: "ZZ Suburb",
      billingCity: null,
      billingPostalCode: "7441",
      consent: "on",
    });
    expect(welcomeSchema.parse({ ...base, phone: "  " }).phone).toBeNull();
  });
  it("needs the consent tick, a name and a South African phone", () => {
    const noConsent = welcomeSchema.safeParse({ ...base, consent: "" });
    expect(noConsent.success).toBe(false);
    expect(noConsent.error?.issues[0]?.message).toBe("Tick the box to agree before you continue.");
    const noName = welcomeSchema.safeParse({ ...base, name: "  " });
    expect(noName.error?.issues[0]?.message).toBe("Enter your name.");
    const badPhone = welcomeSchema.safeParse({ ...base, phone: "12" });
    expect(badPhone.error?.issues[0]?.message).toBe(
      "Enter a South African number, e.g. 082 123 4567.",
    );
    expect(welcomeSchema.safeParse({ ...base, contactId: "nope" }).success).toBe(false);
  });
  it("refuses values that are too long", () => {
    expect(welcomeSchema.safeParse({ ...base, name: "x".repeat(121) }).success).toBe(false);
    expect(welcomeSchema.safeParse({ ...base, name: "x".repeat(120) }).success).toBe(true);
    expect(welcomeSchema.safeParse({ ...base, billingLine1: "x".repeat(151) }).success).toBe(false);
    expect(welcomeSchema.safeParse({ ...base, billingCity: "x".repeat(81) }).success).toBe(false);
    expect(welcomeSchema.safeParse({ ...base, billingPostalCode: "1".repeat(11) }).success).toBe(
      false,
    );
  });
});
