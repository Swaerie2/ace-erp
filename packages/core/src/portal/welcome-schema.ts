import { z } from "zod";
import { normalisePhone } from "../customers/phone";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((v) => (v === "" ? null : v));

/** The welcome form. Everything arrives as text; a blank optional field becomes null. */
export const welcomeSchema = z.object({
  contactId: z.uuid(),
  name: z.string().trim().min(1, "Enter your name.").max(120, "Keep this under 120 characters."),
  phone: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const normalised = normalisePhone(v);
      if (!normalised) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a South African number, e.g. 082 123 4567.",
        });
        return z.NEVER;
      }
      return normalised;
    }),
  billingLine1: optionalText(150),
  billingLine2: optionalText(150),
  billingSuburb: optionalText(80),
  billingCity: optionalText(80),
  billingPostalCode: optionalText(10),
  consent: z.literal("on", { error: "Tick the box to agree before you continue." }),
});
export type WelcomeInput = z.output<typeof welcomeSchema>;
