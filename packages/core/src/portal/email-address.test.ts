import { describe, expect, it } from "vitest";
import { hashEmail, normaliseEmail } from "./email-address";

describe("normaliseEmail", () => {
  it("trims and lowercases a valid address", () => {
    expect(normaliseEmail("  ZZ.Client@Example.COM ")).toBe("zz.client@example.com");
  });
  it("refuses anything that is not an email address", () => {
    for (const bad of [
      "",
      "   ",
      "nobody",
      "a@",
      "@example.com",
      "a b@example.com",
      `${"a".repeat(250)}@example.com`,
    ]) {
      expect(normaliseEmail(bad), bad).toBeNull();
    }
  });
});

describe("hashEmail", () => {
  it("is a stable 64 character hex string that does not contain the address", () => {
    const h = hashEmail("zz.client@example.com");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEmail("zz.client@example.com")).toBe(h);
    expect(hashEmail("zz.other@example.com")).not.toBe(h);
    expect(h).not.toContain("example");
  });
});
