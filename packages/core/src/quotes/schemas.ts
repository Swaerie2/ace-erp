import { z } from "zod";
import { isValidDateString } from "./reference";

export const LINE_KINDS = ["PRICED", "OPTIONAL", "INCLUDED"] as const;
export const LINE_BILLINGS = ["MONTHLY", "ONCE_OFF"] as const;
export const LINE_FREQUENCIES = ["WEEKLY", "FORTNIGHTLY", "MONTHLY", "AS_REQUIRED"] as const;
export const SENT_METHODS = ["WHATSAPP", "EMAIL", "HAND", "OTHER"] as const;
export const STAFF_ACCEPT_METHODS = [
  "WHATSAPP",
  "EMAIL",
  "PHONE",
  "IN_PERSON",
  "SIGNED_COPY",
] as const;

export const FREQUENCY_LABELS: Record<(typeof LINE_FREQUENCIES)[number], string> = {
  WEEKLY: "Weekly",
  FORTNIGHTLY: "Every two weeks",
  MONTHLY: "Monthly",
  AS_REQUIRED: "As required",
};
export const LINE_KIND_LABELS: Record<(typeof LINE_KINDS)[number], string> = {
  PRICED: "Price",
  OPTIONAL: "Optional add-on",
  INCLUDED: "Included",
};
export const BILLING_LABELS: Record<(typeof LINE_BILLINGS)[number], string> = {
  MONTHLY: "Monthly",
  ONCE_OFF: "Once-off",
};
export const SENT_METHOD_LABELS: Record<(typeof SENT_METHODS)[number], string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  HAND: "By hand",
  OTHER: "Other",
};
export const ACCEPT_METHOD_LABELS: Record<
  (typeof STAFF_ACCEPT_METHODS)[number] | "CLIENT_LINK",
  string
> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  PHONE: "Phone",
  IN_PERSON: "In person",
  SIGNED_COPY: "Signed copy",
  CLIENT_LINK: "Client link",
};

export const MAX_LINES = 30;
export const MAX_AMOUNT_CENTS = 100_000_000; // R1 000 000

const dateString = z.string().refine(isValidDateString, "Choose a valid date.");

/** One price line as the builder saves it. Drafts are lenient: an unfinished line is allowed. */
export const draftLineSchema = z.object({
  lineKind: z.enum(LINE_KINDS),
  billing: z.enum(LINE_BILLINGS).nullable(),
  frequency: z.enum(LINE_FREQUENCIES).nullable(),
  description: z.string().trim().max(300, "Keep this under 300 characters."),
  amountCents: z.number().int().positive().max(MAX_AMOUNT_CENTS).nullable(),
});
export type DraftLineInput = z.output<typeof draftLineSchema>;

/** The whole draft, saved in one go. `version` is the draft version the browser last saw. */
export const draftSchema = z.object({
  version: z.number().int().min(1),
  validUntil: dateString,
  internalNote: z.string().trim().max(2000, "Keep this under 2000 characters."),
  scope: z.array(z.object({ serviceId: z.uuid(), included: z.boolean() })).max(50),
  lines: z.array(draftLineSchema).max(MAX_LINES),
});
export type DraftInput = z.output<typeof draftSchema>;

/** Included lines are free and have no billing; once-off lines have no frequency. */
export function normaliseLine(line: DraftLineInput): DraftLineInput {
  if (line.lineKind === "INCLUDED") {
    return { ...line, billing: null, frequency: null, amountCents: null };
  }
  if (line.billing === "ONCE_OFF") return { ...line, frequency: null };
  return line;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((v) => (v === "" ? undefined : v))
    .optional();

/** Staff recording an acceptance. (The client link, phase 3b, has its own input.) */
export const acceptSchema = z.object({
  method: z.enum(STAFF_ACCEPT_METHODS),
  acceptedBy: z
    .string()
    .trim()
    .min(1, "Enter who accepted.")
    .max(120, "Keep this under 120 characters."),
  startDate: dateString,
  chosenLineIds: z.array(z.uuid()).max(MAX_LINES),
  note: optionalText(500),
});
export type AcceptInput = z.output<typeof acceptSchema>;

export const declineSchema = z.object({ reason: optionalText(500) });
export type DeclineInput = z.output<typeof declineSchema>;

type IssueLine = {
  lineKind: (typeof LINE_KINDS)[number];
  billing: (typeof LINE_BILLINGS)[number] | null;
  frequency: (typeof LINE_FREQUENCIES)[number] | null;
  description: string;
  amountCents: number | null;
};

/** What stops a quote being issued, in plain words. An empty list means it can be issued. */
export function validateForIssue(
  input: { validUntil: string; scope: { included: boolean }[]; lines: IssueLine[] },
  today: string,
): string[] {
  const problems: string[] = [];
  if (!input.scope.some((s) => s.included)) problems.push("Switch on at least one service.");
  if (input.validUntil < today) problems.push("The valid-until date must be today or later.");
  input.lines.forEach((line, index) => {
    const n = `Line ${index + 1}`;
    if (!line.description.trim()) problems.push(`${n} needs a description.`);
    if (line.lineKind === "INCLUDED") return;
    if (!line.billing) problems.push(`${n} needs monthly or once-off.`);
    if (line.amountCents === null || line.amountCents <= 0) {
      problems.push(`${n} needs an amount above zero.`);
    }
    if (
      line.lineKind === "PRICED" &&
      line.billing === "MONTHLY" &&
      (line.frequency === null || line.frequency === "AS_REQUIRED")
    ) {
      problems.push(`${n} needs how often (weekly, every two weeks or monthly).`);
    }
  });
  if (!input.lines.some((l) => l.lineKind === "PRICED")) {
    problems.push("Add at least one monthly or once-off price.");
  }
  return problems;
}
