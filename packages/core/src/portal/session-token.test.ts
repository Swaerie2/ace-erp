import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  hashSessionToken,
  isSessionLive,
  isSessionTokenShape,
  newSessionTimes,
  shouldTouchSession,
  slideSessionExpiry,
} from "./session-token";

const DAY = 86_400_000;
const now = new Date("2026-11-23T08:00:00.000Z");

describe("session tokens", () => {
  it("are 43 URL-safe characters, different every time", () => {
    const a = generateSessionToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isSessionTokenShape(a)).toBe(true);
    expect(generateSessionToken()).not.toBe(a);
    for (const bad of ["", "x".repeat(42), "x".repeat(44), `${"a".repeat(42)}!`]) {
      expect(isSessionTokenShape(bad), bad).toBe(false);
    }
  });
  it("are stored only as their SHA-256", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashSessionToken(token)).not.toContain(token);
  });
});

describe("session expiry", () => {
  it("starts with 30 sliding days and 90 absolute days", () => {
    const t = newSessionTimes(now);
    expect(t.lastSeenAt).toEqual(now);
    expect(t.expiresAt.getTime() - now.getTime()).toBe(30 * DAY);
    expect(t.absoluteExpiresAt.getTime() - now.getTime()).toBe(90 * DAY);
  });
  it("slides 30 days from the last use but never past the absolute end", () => {
    const absolute = new Date(now.getTime() + 90 * DAY);
    expect(slideSessionExpiry(new Date(now.getTime() + 10 * DAY), absolute).getTime()).toBe(
      now.getTime() + 40 * DAY,
    );
    expect(slideSessionExpiry(new Date(now.getTime() + 80 * DAY), absolute)).toEqual(absolute);
  });
  it("is live only before both ends", () => {
    const s = {
      expiresAt: new Date(now.getTime() + DAY),
      absoluteExpiresAt: new Date(now.getTime() + 2 * DAY),
    };
    expect(isSessionLive(s, now)).toBe(true);
    expect(isSessionLive(s, new Date(now.getTime() + DAY))).toBe(false);
    expect(isSessionLive({ ...s, absoluteExpiresAt: now }, now)).toBe(false);
  });
  it("touches the session at most once an hour", () => {
    expect(shouldTouchSession(now, new Date(now.getTime() + 59 * 60_000))).toBe(false);
    expect(shouldTouchSession(now, new Date(now.getTime() + 60 * 60_000))).toBe(true);
  });
});
