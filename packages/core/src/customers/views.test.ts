import { describe, expect, it } from "vitest";
import { CREW_CUSTOMER_SELECT } from "./views";

function keysOf(select: unknown, out: string[] = []): string[] {
  if (select && typeof select === "object") {
    for (const [key, value] of Object.entries(select)) {
      if (key === "select") keysOf(value, out);
      else if (key === "where" || key === "orderBy") continue;
      else {
        out.push(key);
        keysOf(value, out);
      }
    }
  }
  return out;
}

describe("crew view", () => {
  it("selects exactly the allowed columns and nothing restricted", () => {
    const keys = keysOf(CREW_CUSTOMER_SELECT).sort();
    expect(keys).toEqual(
      [
        "accessNotes",
        "addressLine1",
        "addressLine2",
        "city",
        "displayName",
        "id",
        "id",
        "label",
        "mapUrl",
        "number",
        "postalCode",
        "properties",
        "status",
        "suburb",
      ].sort(),
    );
    for (const restricted of [
      "email",
      "phone",
      "contacts",
      "notes",
      "billingLine1",
      "companyName",
      "registrationNumber",
      "consentAt",
      "terrainNotes",
    ]) {
      expect(keys).not.toContain(restricted);
    }
  });
});
