import { describe, expect, it } from "vitest";
import { hasPropertyInput } from "./property-input";

describe("hasPropertyInput", () => {
  const blank = { property_label: "Main property", property_addressLine1: "" };

  it("is false for the untouched form, including the prefilled label", () => {
    expect(hasPropertyInput(blank, "property_")).toBe(false);
    expect(
      hasPropertyInput(
        { ...blank, property_suburb: "  ", property_frequency: "", property_preferredDay: "" },
        "property_",
      ),
    ).toBe(false);
  });

  it("is true when only the street is filled", () => {
    expect(hasPropertyInput({ ...blank, property_addressLine1: "1 Road" }, "property_")).toBe(true);
  });

  it("is true when any other property field has input, so it cannot be dropped silently", () => {
    for (const field of [
      "suburb",
      "city",
      "accessNotes",
      "monthlyFee",
      "frequency",
      "preferredDay",
    ]) {
      expect(hasPropertyInput({ ...blank, [`property_${field}`]: "x" }, "property_"), field).toBe(
        true,
      );
    }
  });

  it("ignores fields with other prefixes and a changed label counts as input", () => {
    expect(hasPropertyInput({ contact_name: "Ann", name: "Ann" }, "property_")).toBe(false);
    expect(hasPropertyInput({ property_label: "Cottage" }, "property_")).toBe(true);
  });
});
