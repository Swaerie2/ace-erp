import { describe, expect, it } from "vitest";
import { rateBucket, windowStartFor } from "./rate-limit-window";

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
  it("keeps views and actions in separate buckets", () => {
    expect(rateBucket("view", "abc")).toBe("view:abc");
    expect(rateBucket("act", "abc")).toBe("act:abc");
  });
});
