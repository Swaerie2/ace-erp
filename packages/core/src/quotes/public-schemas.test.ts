import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { linkAcceptSchema, linkDeclineSchema } from "./public";

const valid = { acceptedBy: "A. Client", startDate: "2026-12-01", chosenLineIds: [] as string[] };
const messageOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((i) => i.message) ?? [];

describe("linkAcceptSchema", () => {
  it("accepts a normal request and trims the typed name", () => {
    const parsed = linkAcceptSchema.parse({ ...valid, acceptedBy: "  A. Client  " });
    expect(parsed.acceptedBy).toBe("A. Client");
  });

  it("refuses an empty or blank name with a plain message", () => {
    expect(messageOf(linkAcceptSchema.safeParse({ ...valid, acceptedBy: "   " }))).toContain(
      "Enter your full name.",
    );
  });

  it("allows a name of 120 characters and refuses 121", () => {
    expect(linkAcceptSchema.safeParse({ ...valid, acceptedBy: "x".repeat(120) }).success).toBe(
      true,
    );
    const long = linkAcceptSchema.safeParse({ ...valid, acceptedBy: "x".repeat(121) });
    expect(messageOf(long)).toContain("Keep this to 120 characters or fewer.");
  });

  it("refuses a missing, malformed or impossible start date", () => {
    for (const startDate of ["", "tomorrow", "2026-13-01", "2026-02-30", "01/12/2026"]) {
      const result = linkAcceptSchema.safeParse({ ...valid, startDate });
      expect(messageOf(result), startDate).toContain("Choose a start date.");
    }
  });

  it("requires chosen line ids to be UUIDs, and at most 30 of them", () => {
    expect(linkAcceptSchema.safeParse({ ...valid, chosenLineIds: [randomUUID()] }).success).toBe(
      true,
    );
    expect(linkAcceptSchema.safeParse({ ...valid, chosenLineIds: ["not-a-uuid"] }).success).toBe(
      false,
    );
    const thirty = Array.from({ length: 30 }, () => randomUUID());
    expect(linkAcceptSchema.safeParse({ ...valid, chosenLineIds: thirty }).success).toBe(true);
    expect(
      linkAcceptSchema.safeParse({ ...valid, chosenLineIds: [...thirty, randomUUID()] }).success,
    ).toBe(false);
  });
});

describe("linkDeclineSchema", () => {
  it("trims the reason", () => {
    expect(linkDeclineSchema.parse({ reason: "  Too dear  " }).reason).toBe("Too dear");
  });

  it("turns an empty or blank reason, or no reason, into undefined", () => {
    expect(linkDeclineSchema.parse({ reason: "" }).reason).toBeUndefined();
    expect(linkDeclineSchema.parse({ reason: "   " }).reason).toBeUndefined();
    expect(linkDeclineSchema.parse({}).reason).toBeUndefined();
  });

  it("allows a reason of 500 characters and refuses 501", () => {
    expect(linkDeclineSchema.safeParse({ reason: "x".repeat(500) }).success).toBe(true);
    const long = linkDeclineSchema.safeParse({ reason: "x".repeat(501) });
    expect(messageOf(long)).toContain("Keep this to 500 characters or fewer.");
  });
});
