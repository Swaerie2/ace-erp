import { describe, expect, it } from "vitest";
import {
  CODE_TTL_MINUTES,
  MAX_CODE_ATTEMPTS,
  codeExpiresAt,
  generateSignInCode,
  hashSignInCode,
  isSignInCodeShape,
  newCodeSalt,
  signInCodeMatches,
} from "./codes";

describe("sign-in codes", () => {
  it("are six digits, and vary", () => {
    const codes = Array.from({ length: 40 }, () => generateSignInCode());
    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    expect(new Set(codes).size).toBeGreaterThan(30);
  });
  it("recognise only six digits", () => {
    expect(isSignInCodeShape("012345")).toBe(true);
    for (const bad of ["", "12345", "1234567", "12a456", " 12345", "12 345"]) {
      expect(isSignInCodeShape(bad), bad).toBe(false);
    }
  });
  it("are stored as a salted hash that never contains the code", () => {
    const salt = newCodeSalt();
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(newCodeSalt()).not.toBe(salt);
    const hash = hashSignInCode("123456", salt);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("123456");
    expect(hashSignInCode("123456", newCodeSalt())).not.toBe(hash);
  });
  it("match only the right code with the right salt", () => {
    const salt = newCodeSalt();
    const hash = hashSignInCode("654321", salt);
    expect(signInCodeMatches("654321", salt, hash)).toBe(true);
    expect(signInCodeMatches("654320", salt, hash)).toBe(false);
    expect(signInCodeMatches("654321", newCodeSalt(), hash)).toBe(false);
    // a damaged stored hash (wrong length, not hex) is a mismatch, never an exception
    expect(signInCodeMatches("654321", salt, "abc")).toBe(false);
    expect(signInCodeMatches("654321", salt, "z".repeat(64))).toBe(false);
  });
  it("last ten minutes and die after five wrong tries", () => {
    expect(CODE_TTL_MINUTES).toBe(10);
    expect(MAX_CODE_ATTEMPTS).toBe(5);
    const now = new Date("2026-11-23T08:00:00.000Z");
    expect(codeExpiresAt(now).toISOString()).toBe("2026-11-23T08:10:00.000Z");
  });
});
