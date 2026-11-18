import { describe, expect, it } from "vitest";
import { createStaffInput } from "./staff";

const valid = {
  email: "owner@example.com",
  name: "Lloyd",
  role: "OWNER",
  password: "a-long-enough-password",
} as const;

describe("createStaffInput", () => {
  it("accepts a valid staff member", () => {
    expect(createStaffInput.safeParse(valid).success).toBe(true);
  });

  it("lowercases and trims the email", () => {
    const parsed = createStaffInput.parse({ ...valid, email: "  Owner@Example.COM " });
    expect(parsed.email).toBe("owner@example.com");
  });

  it("rejects a short password", () => {
    expect(createStaffInput.safeParse({ ...valid, password: "short" }).success).toBe(false);
  });

  it("rejects an unknown role", () => {
    expect(createStaffInput.safeParse({ ...valid, role: "ADMIN" }).success).toBe(false);
  });

  it("rejects a blank name and a bad email", () => {
    expect(createStaffInput.safeParse({ ...valid, name: "   " }).success).toBe(false);
    expect(createStaffInput.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });
});
