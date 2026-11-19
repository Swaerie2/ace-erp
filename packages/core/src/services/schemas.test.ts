import { describe, expect, it } from "vitest";
import {
  SERVICE_DESCRIPTION_MAX,
  SERVICE_KIND_LABELS,
  SERVICE_KINDS,
  SERVICE_NAME_MAX,
  serviceSchema,
} from "./schemas";

const valid = { name: "Lawn Mowing", description: "Mowing and edging.", kind: "CORE" };

describe("serviceSchema", () => {
  it("accepts a normal service and trims the text", () => {
    const result = serviceSchema.parse({
      name: "  Lawn Mowing  ",
      description: "  Mowing and edging.  ",
      kind: "OPTIONAL_EXTRA",
    });
    expect(result).toEqual({
      name: "Lawn Mowing",
      description: "Mowing and edging.",
      kind: "OPTIONAL_EXTRA",
    });
  });

  it("rejects a blank name and a blank description with plain messages", () => {
    const result = serviceSchema.safeParse({ ...valid, name: "   ", description: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const messages = result.error.issues.map((i) => i.message);
    expect(messages).toContain("Enter a name.");
    expect(messages).toContain("Enter a description.");
  });

  it("allows the maximum lengths and rejects one more", () => {
    expect(
      serviceSchema.safeParse({
        ...valid,
        name: "a".repeat(SERVICE_NAME_MAX),
        description: "b".repeat(SERVICE_DESCRIPTION_MAX),
      }).success,
    ).toBe(true);
    expect(
      serviceSchema.safeParse({ ...valid, name: "a".repeat(SERVICE_NAME_MAX + 1) }).success,
    ).toBe(false);
    expect(
      serviceSchema.safeParse({ ...valid, description: "b".repeat(SERVICE_DESCRIPTION_MAX + 1) })
        .success,
    ).toBe(false);
  });

  it("rejects a missing or unknown kind", () => {
    expect(serviceSchema.safeParse({ name: "X", description: "Y" }).success).toBe(false);
    expect(serviceSchema.safeParse({ ...valid, kind: "PREMIUM" }).success).toBe(false);
  });

  it("has a label for every kind", () => {
    for (const kind of SERVICE_KINDS) expect(SERVICE_KIND_LABELS[kind]).toBeTruthy();
    expect(SERVICE_KIND_LABELS.OPTIONAL_EXTRA).toBe("Optional extra");
  });
});
