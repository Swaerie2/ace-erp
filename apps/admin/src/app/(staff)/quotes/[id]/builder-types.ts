import {
  MAX_AMOUNT_CENTS,
  parseRandToCents,
  type LINE_BILLINGS,
  type LINE_FREQUENCIES,
  type LINE_KINDS,
} from "@ace/core/client";

export type LineKind = (typeof LINE_KINDS)[number];
export type Billing = (typeof LINE_BILLINGS)[number];
export type Frequency = (typeof LINE_FREQUENCIES)[number];

export type BuilderLine = {
  /** Local identity for React lists and the preview; not stored. */
  key: string;
  lineKind: LineKind;
  billing: Billing | null;
  frequency: Frequency | null;
  description: string;
  /** What the person typed, in rand. Converted to cents when saving. */
  amountText: string;
};

export type BuilderScope = {
  serviceId: string;
  name: string;
  description: string;
  kind: string;
  included: boolean;
};

export type BuilderState = {
  scope: BuilderScope[];
  lines: BuilderLine[];
  /** YYYY-MM-DD */
  validUntil: string;
  internalNote: string;
};

export type BuilderInitial = {
  id: string;
  version: number;
  state: BuilderState;
  /** e.g. "QUO-2026-0104" when this draft revises an issued quote */
  revisionOfReference: string | null;
  customerName: string;
  siteLabel: string;
  /** staff-only reference notes about the property */
  property: { lawnSizeSqm: number | null; accessNotes: string | null };
  preparedFor: {
    name: string;
    email: string | null;
    phone: string | null;
    siteLabel: string;
    siteAddress: string;
  };
  wording: {
    tagline: string;
    standardExclusions: string[];
    monthlyTerms: { heading: string; body: string }[];
    onceOffTerms: { heading: string; body: string }[];
    commonTerms: { heading: string; body: string }[];
    everyVisitPoints: string[];
    defaultValidityDays: number;
    registrationNumber: string;
    phone: string;
    email: string;
    website: string;
  };
  org: { legalName: string; tradingName: string; vatEnabled: boolean };
  today: string;
};

/** Rand text to cents. Blank, invalid, zero or too large all give null (the form shows a message). */
export function parseAmount(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const cents = parseRandToCents(t);
  return cents !== null && cents > 0 && cents <= MAX_AMOUNT_CENTS ? cents : null;
}

export function amountProblem(text: string): string | null {
  if (text.trim() === "") return null;
  return parseAmount(text) === null ? "Enter an amount like 850 or 1150.50." : null;
}

export function newKey(): string {
  return globalThis.crypto.randomUUID();
}

export function blankLine(over: Partial<BuilderLine> = {}): BuilderLine {
  return {
    key: newKey(),
    lineKind: "PRICED",
    billing: "MONTHLY",
    frequency: "WEEKLY",
    description: "",
    amountText: "",
    ...over,
  };
}

/** Switching the kind keeps the other settings sensible: included lines are free, add-ons are "as required". */
export function withKind(line: BuilderLine, kind: LineKind): BuilderLine {
  if (kind === "INCLUDED") {
    return { ...line, lineKind: kind, billing: null, frequency: null, amountText: "" };
  }
  return withBilling({ ...line, lineKind: kind }, line.billing ?? "MONTHLY");
}

export function withBilling(line: BuilderLine, billing: Billing): BuilderLine {
  if (billing === "ONCE_OFF") return { ...line, billing, frequency: null };
  const fallback: Frequency = line.lineKind === "OPTIONAL" ? "AS_REQUIRED" : "WEEKLY";
  const current = line.frequency ?? fallback;
  const frequency = current === "AS_REQUIRED" && line.lineKind === "PRICED" ? "WEEKLY" : current;
  return { ...line, billing, frequency };
}

/** The DraftInput the server expects (without `version`). Key order is fixed so the text compares. */
export function toPayload(state: BuilderState) {
  return {
    validUntil: state.validUntil,
    internalNote: state.internalNote,
    scope: state.scope.map((s) => ({ serviceId: s.serviceId, included: s.included })),
    lines: state.lines.map((l) => ({
      lineKind: l.lineKind,
      billing: l.billing,
      frequency: l.frequency,
      description: l.description,
      amountCents: parseAmount(l.amountText),
    })),
  };
}
