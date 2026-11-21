import { describe, expect, it } from "vitest";
import {
  acceptSchema,
  declineSchema,
  draftSchema,
  normaliseLine,
  validateForIssue,
} from "./schemas";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("draftSchema", () => {
  const valid = {
    version: 1,
    validUntil: "2026-12-19",
    internalNote: "  gate code at side  ",
    scope: [{ serviceId: uuid, included: true }],
    lines: [
      {
        lineKind: "PRICED",
        billing: "MONTHLY",
        frequency: "WEEKLY",
        description: "  Garden maintenance, as per scope  ",
        amountCents: 115000,
      },
    ],
  };
  it("accepts a draft and trims the text", () => {
    const parsed = draftSchema.parse(valid);
    expect(parsed.internalNote).toBe("gate code at side");
    expect(parsed.lines[0]?.description).toBe("Garden maintenance, as per scope");
  });
  it("lets an unfinished line through (drafts are lenient)", () => {
    const parsed = draftSchema.safeParse({
      ...valid,
      lines: [
        { lineKind: "PRICED", billing: null, frequency: null, description: "", amountCents: null },
      ],
    });
    expect(parsed.success).toBe(true);
  });
  it("rejects a bad date, a negative amount and too many lines", () => {
    expect(draftSchema.safeParse({ ...valid, validUntil: "2026-02-30" }).success).toBe(false);
    expect(
      draftSchema.safeParse({
        ...valid,
        lines: [{ ...valid.lines[0], amountCents: -5 }],
      }).success,
    ).toBe(false);
    expect(
      draftSchema.safeParse({ ...valid, lines: Array.from({ length: 31 }, () => valid.lines[0]) })
        .success,
    ).toBe(false);
  });
});

describe("normaliseLine", () => {
  it("makes an included line free and removes a frequency from a once-off line", () => {
    expect(
      normaliseLine({
        lineKind: "INCLUDED",
        billing: "MONTHLY",
        frequency: "WEEKLY",
        description: "Green waste removal",
        amountCents: 500,
      }),
    ).toEqual({
      lineKind: "INCLUDED",
      billing: null,
      frequency: null,
      description: "Green waste removal",
      amountCents: null,
    });
    expect(
      normaliseLine({
        lineKind: "PRICED",
        billing: "ONCE_OFF",
        frequency: "WEEKLY",
        description: "Clean-up",
        amountCents: 240000,
      }).frequency,
    ).toBeNull();
  });
});

describe("validateForIssue", () => {
  const good = {
    validUntil: "2026-12-19",
    scope: [{ included: true }],
    lines: [
      {
        lineKind: "PRICED" as const,
        billing: "MONTHLY" as const,
        frequency: "WEEKLY" as const,
        description: "Garden maintenance",
        amountCents: 115000,
      },
    ],
  };
  it("passes a complete quote", () => {
    expect(validateForIssue(good, "2026-11-19")).toEqual([]);
  });
  it("explains every problem in plain words", () => {
    const problems = validateForIssue(
      {
        validUntil: "2026-11-01",
        scope: [{ included: false }],
        lines: [
          {
            lineKind: "PRICED",
            billing: null,
            frequency: null,
            description: "",
            amountCents: null,
          },
          {
            lineKind: "PRICED",
            billing: "MONTHLY",
            frequency: null,
            description: "Mowing",
            amountCents: 100,
          },
        ],
      },
      "2026-11-19",
    );
    expect(problems).toEqual([
      "Switch on at least one service.",
      "The valid-until date must be today or later.",
      "Line 1 needs a description.",
      "Line 1 needs monthly or once-off.",
      "Line 1 needs an amount above zero.",
      "Line 2 needs how often (weekly, every two weeks or monthly).",
    ]);
  });
  it("needs at least one priced line, not only optional add-ons", () => {
    const problems = validateForIssue(
      {
        ...good,
        lines: [
          {
            lineKind: "OPTIONAL",
            billing: "MONTHLY",
            frequency: "AS_REQUIRED",
            description: "Weed treatment",
            amountCents: 10000,
          },
        ],
      },
      "2026-11-19",
    );
    expect(problems).toEqual(["Add at least one monthly or once-off price."]);
  });
  it("asks for a line when there are none", () => {
    expect(validateForIssue({ ...good, lines: [] }, "2026-11-19")).toEqual([
      "Add at least one monthly or once-off price.",
    ]);
  });
});

describe("acceptSchema and declineSchema", () => {
  it("needs who accepted and a start date", () => {
    expect(
      acceptSchema.safeParse({ method: "WHATSAPP", acceptedBy: "", startDate: "" }).success,
    ).toBe(false);
    const ok = acceptSchema.parse({
      method: "PHONE",
      acceptedBy: " A. Client ",
      startDate: "2026-12-01",
      chosenLineIds: [],
      note: "",
    });
    expect(ok.acceptedBy).toBe("A. Client");
    expect(ok.note).toBeUndefined();
  });
  it("does not allow the client-link method for staff", () => {
    expect(
      acceptSchema.safeParse({
        method: "CLIENT_LINK",
        acceptedBy: "A",
        startDate: "2026-12-01",
        chosenLineIds: [],
      }).success,
    ).toBe(false);
  });
  it("makes the decline reason optional", () => {
    expect(declineSchema.parse({}).reason).toBeUndefined();
    expect(declineSchema.parse({ reason: "  too dear " }).reason).toBe("too dear");
  });
});
