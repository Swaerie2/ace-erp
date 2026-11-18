import { describe, expect, it } from "vitest";
import { formatCustomerNumber, parseCustomerNumber } from "./number";

describe("customer numbers", () => {
  it("formats with padding", () => {
    expect(formatCustomerNumber(1)).toBe("C-0001");
    expect(formatCustomerNumber(12345)).toBe("C-12345");
  });
  it("parses what staff type", () => {
    expect(parseCustomerNumber("C-0012")).toBe(12);
    expect(parseCustomerNumber(" c0012 ")).toBe(12);
    expect(parseCustomerNumber("12")).toBeNull();
    expect(parseCustomerNumber("Mrs Smith")).toBeNull();
  });
});
