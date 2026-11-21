import { describe, expect, it } from "vitest";
import { generateLinkToken, isLinkTokenShape } from "./token";

describe("link tokens", () => {
  it("are 43 URL-safe characters and different every time", () => {
    const a = generateLinkToken();
    const b = generateLinkToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isLinkTokenShape(a)).toBe(true);
    expect(a).not.toBe(b);
  });
  it("rejects anything that is not the right shape", () => {
    for (const bad of [
      "",
      "short",
      "x".repeat(42),
      "x".repeat(44),
      `${"a".repeat(42)}!`,
      `${"a".repeat(42)} `,
    ]) {
      expect(isLinkTokenShape(bad)).toBe(false);
    }
  });
});
