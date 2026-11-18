import { describe, expect, it } from "vitest";
import { normalisePhone } from "./phone";

describe("normalisePhone", () => {
  it.each([
    ["082 123 4567", "+27821234567"],
    ["0821234567", "+27821234567"],
    ["+27 82 123 4567", "+27821234567"],
    ["27821234567", "+27821234567"],
    ["0027 82 123 4567", "+27821234567"],
    ["(011) 123-4567", "+27111234567"],
  ])("reads %s", (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it.each(["", "   ", "123", "abc", "+44 20 7946 0958", "082 123 456", "082 123 45678"])(
    "rejects %s",
    (input) => {
      expect(normalisePhone(input)).toBeNull();
    },
  );
});
