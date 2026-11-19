import { describe, expect, it } from "vitest";
import { normalisePhone } from "./phone";

describe("normalisePhone", () => {
  it.each(["call 082 123 4567", "0821234567abc", "082 123 4567 ext 5", "+27 82 123 4567 x"])(
    "rejects text mixed in with the number: %s",
    (input) => {
      expect(normalisePhone(input)).toBeNull();
    },
  );
  it("does not treat a (0) elsewhere as the trunk prefix", () => {
    expect(normalisePhone("082 (0) 123 4567")).toBeNull();
  });

  it.each([
    ["082 123 4567", "+27821234567"],
    ["0821234567", "+27821234567"],
    ["+27 82 123 4567", "+27821234567"],
    ["27821234567", "+27821234567"],
    ["0027 82 123 4567", "+27821234567"],
    ["(011) 123-4567", "+27111234567"],
    ["+27 (0)82 123 4567", "+27821234567"],
    ["+27(0)821234567", "+27821234567"],
    ["0027 (0) 82 123 4567", "+27821234567"],
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
