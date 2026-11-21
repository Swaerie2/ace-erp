import { describe, expect, it } from "vitest";
import { publicViewState } from "./public-state";
import { fromDateString } from "./reference";

const valid = fromDateString("2026-12-31");

describe("publicViewState", () => {
  it("shows an issued quote as open until its last valid day, then expired", () => {
    expect(publicViewState({ status: "ISSUED", validUntil: valid }, "2026-12-31")).toBe("OPEN");
    expect(publicViewState({ status: "ISSUED", validUntil: valid }, "2027-01-01")).toBe("EXPIRED");
  });
  it("maps the other statuses and hides drafts", () => {
    expect(publicViewState({ status: "ACCEPTED", validUntil: valid }, "2030-01-01")).toBe(
      "ACCEPTED",
    );
    expect(publicViewState({ status: "DECLINED", validUntil: valid }, "2030-01-01")).toBe(
      "DECLINED",
    );
    expect(publicViewState({ status: "REPLACED", validUntil: valid }, "2030-01-01")).toBe(
      "REPLACED",
    );
    expect(publicViewState({ status: "WITHDRAWN", validUntil: valid }, "2030-01-01")).toBe(
      "WITHDRAWN",
    );
    expect(publicViewState({ status: "DRAFT", validUntil: valid }, "2026-01-01")).toBeNull();
  });
});
