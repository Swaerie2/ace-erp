import { describe, expect, it } from "vitest";
import { RATE_LIMITS, rateBucket, windowStartFor } from "./rate-limit-window";

describe("rate limit windows", () => {
  it("rounds down to the start of the 10 minute window in UTC", () => {
    expect(windowStartFor(new Date("2026-11-21T10:07:31.500Z")).toISOString()).toBe(
      "2026-11-21T10:00:00.000Z",
    );
    expect(windowStartFor(new Date("2026-11-21T10:10:00.000Z")).toISOString()).toBe(
      "2026-11-21T10:10:00.000Z",
    );
    expect(windowStartFor(new Date("2026-11-21T10:19:59.999Z")).toISOString()).toBe(
      "2026-11-21T10:10:00.000Z",
    );
  });
  it("rounds down to the hour for the sign-in code limits", () => {
    expect(windowStartFor(new Date("2026-11-23T10:59:59.000Z"), 60).toISOString()).toBe(
      "2026-11-23T10:00:00.000Z",
    );
  });
  it("rounds down to the start of the UTC day for the daily sign-in code limit", () => {
    expect(windowStartFor(new Date("2026-11-23T23:59:59.999Z"), 1440).toISOString()).toBe(
      "2026-11-23T00:00:00.000Z",
    );
    expect(windowStartFor(new Date("2026-11-24T00:00:00.000Z"), 1440).toISOString()).toBe(
      "2026-11-24T00:00:00.000Z",
    );
  });
  it("keeps every kind in its own bucket", () => {
    expect(rateBucket("view", "abc")).toBe("view:abc");
    expect(rateBucket("act", "abc")).toBe("act:abc");
    expect(rateBucket("code-email", "abc")).toBe("code-email:abc");
    expect(rateBucket("code-ip", "abc")).toBe("code-ip:abc");
    expect(rateBucket("code-email-day", "abc")).toBe("code-email-day:abc");
  });
  it("allows 3 code requests per email and 10 per visitor per hour", () => {
    expect(RATE_LIMITS["code-email"]).toEqual({ limit: 3, windowMinutes: 60 });
    expect(RATE_LIMITS["code-ip"]).toEqual({ limit: 10, windowMinutes: 60 });
    expect(RATE_LIMITS["code-email-day"]).toEqual({ limit: 10, windowMinutes: 1440 });
    expect(RATE_LIMITS.view).toEqual({ limit: 120, windowMinutes: 10 });
    expect(RATE_LIMITS.act).toEqual({ limit: 10, windowMinutes: 10 });
  });
});
