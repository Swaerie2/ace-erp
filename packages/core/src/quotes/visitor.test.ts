import { describe, expect, it } from "vitest";
import { cleanUserAgent, clientIpFromHeaders } from "./visitor";

const headers = (map: Record<string, string>) => (name: string) => map[name] ?? null;

describe("clientIpFromHeaders", () => {
  it("takes the first address in x-forwarded-for", () => {
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe(
      "203.0.113.5",
    );
  });
  it("falls back to x-real-ip, accepts IPv6, and returns null when nothing usable is sent", () => {
    expect(clientIpFromHeaders(headers({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(clientIpFromHeaders(headers({}))).toBeNull();
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "not an address" }))).toBeNull();
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "<script>" }))).toBeNull();
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "1".repeat(80) }))).toBeNull();
  });
});

describe("cleanUserAgent", () => {
  it("trims, strips control characters and caps the length", () => {
    expect(cleanUserAgent("  Mozilla/5.0 \n (X11)  ")).toBe("Mozilla/5.0  (X11)");
    expect(cleanUserAgent("a".repeat(500))).toHaveLength(300);
  });
  it("returns null for nothing", () => {
    expect(cleanUserAgent(null)).toBeNull();
    expect(cleanUserAgent("   ")).toBeNull();
  });
});
