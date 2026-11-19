import { formatZAR } from "../money";
import type { QuoteDisplayStatus } from "./reference";
import { acceptedTotals, quoteTotals, type TotalsLine } from "./totals";
import { FREQUENCY_LABELS, type LINE_FREQUENCIES } from "./schemas";
import { bulletLines, type WordingSnapshot } from "./wording-schema";

export type DocumentLine = TotalsLine & {
  id: string;
  frequency: (typeof LINE_FREQUENCIES)[number] | null;
  description: string;
};

export type DocumentInput = {
  status: QuoteDisplayStatus;
  /** null for a draft */
  reference: string | null;
  issuedDate: string | null;
  validUntil: string;
  preparedFor: {
    name: string;
    email: string | null;
    phone: string | null;
    siteLabel: string;
    siteAddress: string;
  };
  scope: { name: string; description: string; kind: string; included: boolean }[];
  lines: DocumentLine[];
  wording: WordingSnapshot;
};

export type QuoteDocument = {
  reference: string;
  status: QuoteDisplayStatus;
  issuedDate: string | null;
  validUntil: string;
  tagline: string;
  business: WordingSnapshot["business"];
  preparedFor: DocumentInput["preparedFor"];
  summary: {
    monthlyTotal: string | null;
    frequencyLabel: string | null;
    onceOffTotal: string | null;
    optionalNote: string | null;
  };
  scope: {
    included: { name: string; bullets: string[] }[];
    excludedNames: string[];
    standardExclusions: string[];
  };
  pricing: {
    rows: {
      id: string;
      kind: "PRICED" | "OPTIONAL" | "INCLUDED";
      description: string;
      billingLabel: string;
      frequencyLabel: string;
      amountLabel: string;
    }[];
    totals: {
      monthly: string | null;
      onceOff: string | null;
      monthlyWithOptions: string | null;
      onceOffWithOptions: string | null;
    };
    acceptedMonthly: string | null;
    acceptedOnceOff: string | null;
  };
  termSections: WordingSnapshot["termSections"];
  everyVisitPoints: string[];
  vatNote: string;
};

const money = (cents: number): string => formatZAR(cents);
const orNull = (cents: number): string | null => (cents > 0 ? money(cents) : null);

/** Everything the screen and the PDF show, as plain data. No layout decisions live here. */
export function buildQuoteDocument(input: DocumentInput): QuoteDocument {
  const totals = quoteTotals(input.lines);
  const accepted = acceptedTotals(input.lines);
  const monthlyLines = input.lines.filter(
    (l) => l.lineKind === "PRICED" && l.billing === "MONTHLY",
  );
  const hasOptions = input.lines.some((l) => l.lineKind === "OPTIONAL");

  const rows = input.lines.map((l) => ({
    id: l.id,
    kind: l.lineKind,
    description: l.description,
    billingLabel: l.billing === "MONTHLY" ? "Monthly" : l.billing === "ONCE_OFF" ? "Once-off" : "",
    frequencyLabel: l.frequency ? FREQUENCY_LABELS[l.frequency] : "",
    amountLabel:
      l.lineKind === "INCLUDED"
        ? "Included"
        : l.amountCents === null
          ? ""
          : l.lineKind === "OPTIONAL"
            ? `+${money(l.amountCents)}`
            : money(l.amountCents),
  }));

  return {
    reference: input.reference ?? "Draft",
    status: input.status,
    issuedDate: input.issuedDate,
    validUntil: input.validUntil,
    tagline: input.wording.tagline,
    business: input.wording.business,
    preparedFor: input.preparedFor,
    summary: {
      monthlyTotal: orNull(totals.monthly),
      frequencyLabel:
        monthlyLines.length === 1 && monthlyLines[0]?.frequency
          ? FREQUENCY_LABELS[monthlyLines[0].frequency]
          : monthlyLines.length > 1
            ? "See pricing"
            : null,
      onceOffTotal: orNull(totals.onceOff),
      optionalNote: hasOptions ? "Optional add-ons available" : null,
    },
    scope: {
      included: input.scope
        .filter((s) => s.included)
        .map((s) => ({ name: s.name, bullets: bulletLines(s.description) })),
      excludedNames: input.scope.filter((s) => !s.included).map((s) => s.name),
      standardExclusions: input.wording.exclusions,
    },
    pricing: {
      rows,
      totals: {
        monthly: orNull(totals.monthly),
        onceOff: orNull(totals.onceOff),
        monthlyWithOptions: totals.optionalMonthly > 0 ? money(totals.monthlyWithOptions) : null,
        onceOffWithOptions: totals.optionalOnceOff > 0 ? money(totals.onceOffWithOptions) : null,
      },
      acceptedMonthly: orNull(accepted.monthly),
      acceptedOnceOff: orNull(accepted.onceOff),
    },
    termSections: input.wording.termSections,
    everyVisitPoints: input.wording.everyVisitPoints,
    vatNote: input.wording.vatEnabled
      ? "All amounts in ZAR."
      : "All amounts in ZAR. ACE Garden Services is not VAT registered, no VAT is charged.",
  };
}
