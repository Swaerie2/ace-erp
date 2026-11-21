import { describe, expect, it } from "vitest";
import { contentHash, stableStringify } from "./content";

describe("stableStringify", () => {
  it("sorts object keys at every level so the same content always gives the same text", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}',
    );
  });
  it("keeps null and drops undefined fields", () => {
    expect(stableStringify({ a: null, b: undefined })).toBe('{"a":null}');
  });
});

describe("contentHash", () => {
  it("is a 64 character hex string that changes when anything changes", () => {
    const a = contentHash({ total: 115000, lines: ["x"] });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash({ lines: ["x"], total: 115000 })).toBe(a);
    expect(contentHash({ total: 115001, lines: ["x"] })).not.toBe(a);
  });
});
