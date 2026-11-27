import { z } from "zod";
import { normalisePhone } from "./phone";

export const CUSTOMER_SOURCES = ["REFERRAL", "GOOGLE", "FACEBOOK", "DIRECTORY", "OTHER"] as const;
export const SERVICE_FREQUENCIES = ["WEEKLY", "FORTNIGHTLY", "MONTHLY", "ONCE_OFF"] as const;
export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

// --- building blocks. Form boxes arrive as strings; blank means "not given". ---------------

const tooLong = (max: number) => `Keep this under ${max} characters.`;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, tooLong(max))
    .transform((v) => (v === "" ? undefined : v))
    .optional();

const requiredText = (what: string, max: number) =>
  z.string().trim().min(1, `Enter ${what}.`).max(max, tooLong(max));

const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), z.enum(values).optional());

const email = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address.")
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const phone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return undefined;
    const normalised = normalisePhone(v);
    if (!normalised) {
      ctx.addIssue({ code: "custom", message: "Enter a South African number, e.g. 082 123 4567." });
      return z.NEVER;
    }
    return normalised;
  })
  .optional();

const wholeNumber = (max: number) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return undefined;
      if (!/^\d+$/.test(v) || Number(v) > max) {
        ctx.addIssue({ code: "custom", message: `Enter a whole number up to ${max}.` });
        return z.NEVER;
      }
      return Number(v);
    })
    .optional();

/** "850", "R 850.50", "1,250.50", "R 1 250,50" -> cents. Anything else -> null. */
export function parseRandToCents(input: string): number | null {
  let s = input.trim().replace(/^R\s*/i, "").replace(/\s/g, "");
  s = s.includes(",") && s.includes(".") ? s.replace(/,/g, "") : s.replace(",", ".");
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!match?.[1]) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** 125050 -> "1250.50", for putting a stored fee back into an edit box. */
export function formatCentsForInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

const webLink = z
  .string()
  .trim()
  .max(500, tooLong(500))
  .refine((v) => v === "" || /^https?:\/\//i.test(v), "Use a full link starting with https://")
  .transform((v) => (v === "" ? undefined : v))
  .optional();

// --- the three records ------------------------------------------------------------------------

export const customerSchema = z.object({
  type: z.enum(["PERSON", "COMPANY"]),
  displayName: requiredText("a name", 120),
  companyName: text(120),
  registrationNumber: text(40),
  status: z.enum(["LEAD", "ACTIVE", "PAUSED"]).default("ACTIVE"),
  billingLine1: text(150),
  billingLine2: text(150),
  billingSuburb: text(80),
  billingCity: text(80),
  billingPostalCode: text(10),
  source: optionalEnum(CUSTOMER_SOURCES),
  sourceNote: text(200),
  notes: text(2000),
  consentGiven: checkbox,
  consentSource: text(40),
  consentNote: text(300),
});
export type CustomerInput = z.output<typeof customerSchema>;

export const contactSchema = z
  .object({
    name: requiredText("a name", 120),
    role: text(60),
    email,
    phone,
    receivesQuotes: checkbox,
    receivesInvoices: checkbox,
  })
  .refine((c) => Boolean(c.email || c.phone), {
    message: "Add an email or a phone number.",
    path: ["email"],
  });
export type ContactInput = z.output<typeof contactSchema>;

export const propertySchema = z.object({
  label: requiredText("a label, e.g. Main house", 80),
  addressLine1: requiredText("a street address", 150),
  addressLine2: text(150),
  suburb: text(80),
  city: text(80),
  postalCode: text(10),
  mapUrl: webLink,
  accessNotes: text(1000),
  lawnSizeSqm: wholeNumber(1_000_000),
  grassType: text(60),
  hasIrrigation: checkbox,
  terrainNotes: text(1000),
  frequency: optionalEnum(SERVICE_FREQUENCIES),
  preferredDay: optionalEnum(WEEKDAYS),
});
export type PropertyInput = z.output<typeof propertySchema>;
