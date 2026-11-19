import { z } from "zod";

const line = (max: number) => z.string().trim().min(1, "This line is empty.").max(max);
const clause = z.object({
  heading: z.string().trim().min(1, "Enter a heading.").max(80),
  body: z.string().trim().min(1, "Enter the wording.").max(1500),
});
export type Clause = z.output<typeof clause>;

/** The standard wording the owner edits. Each issued quote keeps a frozen copy (see snapshotWording). */
export const wordingSchema = z.object({
  tagline: z.string().trim().min(1, "Enter a tagline.").max(120),
  standardExclusions: z.array(line(300)).max(20),
  monthlyTerms: z.array(clause).max(30),
  onceOffTerms: z.array(clause).max(30),
  commonTerms: z.array(clause).max(30),
  everyVisitPoints: z.array(line(200)).max(15),
  defaultValidityDays: z.number().int().min(1).max(365),
  registrationNumber: z.string().trim().max(60),
  phone: z.string().trim().max(40),
  email: z.string().trim().max(120),
  website: z.string().trim().max(120),
});
export type WordingInput = z.output<typeof wordingSchema>;

/** The same values the migration seeds. Used by tests and as the "reset" reference. */
export const DEFAULT_WORDING: WordingInput = {
  tagline: "We don't cut corners. We define them.",
  standardExclusions: [
    "Tree work, landscaping and redesign.",
    "Plants, compost and fertiliser (supplied at cost on written approval).",
    "Other seasonal treatments: fertilising, scarifying, top-dressing and pest spraying.",
  ],
  monthlyTerms: [
    { heading: "Payment", body: "Payable in advance on or before the 30th of each month." },
    {
      heading: "Late payment",
      body: "Accounts not settled by the 5th of the following month attract a R100.00 late payment fee.",
    },
    {
      heading: "Annual escalation",
      body: "Service fees are reviewed annually each March; the projected escalation rate ranges between 6 and 8%.",
    },
    {
      heading: "Termination",
      body: "Either party may terminate this agreement without cause on 30 (thirty) days' written notice. On termination, the Client's obligation is limited to payment for services rendered up to the termination date, plus one (1) month's notice period at the contracted rate.",
    },
    {
      heading: "Scheduled closures",
      body: "In line with labour legislation, our teams take annual leave: two (2) weeks in July and one (1) week over the December/January festive season. Full monthly fees remain payable during these periods.",
    },
  ],
  onceOffTerms: [
    { heading: "Payment", body: "Once-off work is payable before the work is completed." },
    {
      heading: "Scope",
      body: "Work outside the scope described in this quotation is quoted separately on request.",
    },
  ],
  commonTerms: [
    {
      heading: "Limitation of liability",
      body: "In the event of accidental damage caused by ACE Garden Services, written notification must be submitted within 5 (five) working days of the incident. All claims will be directed to ACE Garden Services' insurer. No cash settlements will be made directly by ACE Garden Services. The Client's full cooperation is required; failure to cooperate may result in claims being delayed or declined by the insurer.",
    },
    {
      heading: "Force majeure",
      body: "Neither party shall be held liable for delays or failure to perform obligations arising from causes beyond their reasonable control, including but not limited to natural disasters, severe weather events, or government-imposed restrictions.",
    },
    {
      heading: "Banking details",
      body: "Banking details will be confirmed by way of an official bank account confirmation letter on acceptance of this quotation.",
    },
  ],
  everyVisitPoints: [
    "Your service is scheduled to a fixed day every week.",
    "Team clocks in and out with a GPS time stamp.",
    "Before and after photos on every visit.",
    "A service report is emailed to you after each visit.",
    "Branded ACE overalls and cap.",
    "Vetted staff with ACE ID.",
    "Same team every visit.",
  ],
  defaultValidityDays: 30,
  registrationNumber: "2026/295342/07",
  phone: "079 296 0578",
  email: "info@acegardens.co.za",
  website: "www.acegardens.co.za",
};

export const wordingSnapshotSchema = z.object({
  tagline: z.string(),
  exclusions: z.array(z.string()),
  termSections: z.array(z.object({ title: z.string(), clauses: z.array(clause) })),
  everyVisitPoints: z.array(z.string()),
  business: z.object({
    legalName: z.string(),
    tradingName: z.string(),
    registrationNumber: z.string(),
    phone: z.string(),
    email: z.string(),
    website: z.string(),
  }),
  vatEnabled: z.boolean(),
});
export type WordingSnapshot = z.output<typeof wordingSnapshotSchema>;

/**
 * The frozen wording for one quote: the terms that apply to the kinds of work on it (monthly,
 * once-off or both, an optional add-on counts), plus the common clauses, the exclusions, the
 * every-visit points and the business details.
 */
export function snapshotWording(
  wording: WordingInput,
  lines: readonly { lineKind: string; billing: string | null }[],
  org: { legalName: string; tradingName: string; vatEnabled: boolean },
): WordingSnapshot {
  const priced = lines.filter((l) => l.lineKind !== "INCLUDED");
  const hasMonthly = priced.some((l) => l.billing === "MONTHLY");
  const hasOnceOff = priced.some((l) => l.billing === "ONCE_OFF");
  const termSections: WordingSnapshot["termSections"] = [];
  if (hasMonthly) termSections.push({ title: "Monthly contract", clauses: wording.monthlyTerms });
  if (hasOnceOff) termSections.push({ title: "Once-off work", clauses: wording.onceOffTerms });
  termSections.push({ title: "General", clauses: wording.commonTerms });
  return {
    tagline: wording.tagline,
    exclusions: wording.standardExclusions,
    termSections,
    everyVisitPoints: wording.everyVisitPoints,
    business: {
      legalName: org.legalName,
      tradingName: org.tradingName,
      registrationNumber: wording.registrationNumber,
      phone: wording.phone,
      email: wording.email,
      website: wording.website,
    },
    vatEnabled: org.vatEnabled,
  };
}

/** One bullet per non-blank line of a description. */
export function bulletLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
