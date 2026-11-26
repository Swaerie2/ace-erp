import "server-only";
import { checkRateLimit, getPortalDb, linkAcceptSchema, type LinkAcceptInput } from "@ace/core";
import { z } from "zod";
import type { FormState } from "@/lib/form-state";
import { getVisitor, type Visitor } from "@/lib/visitor";

export const TRY_AGAIN = "Too many attempts. Please wait ten minutes and try again.";
export const BAD_REQUEST = "Something went wrong. Refresh the page and try again.";

export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export function errorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, messages] of Object.entries(z.flattenError(error).fieldErrors)) {
    const message = (messages as string[] | undefined)?.[0];
    if (message) out[field] = message;
  }
  return out;
}

/**
 * Counts the attempt against the visitor's allowance. Refuses crawlers and clients with no browser string.
 * A refusal hands back what was typed, so the form does not wipe it.
 */
export async function guardAction(
  values: Record<string, string>,
): Promise<{ visitor: Visitor } | { refused: FormState }> {
  const visitor = await getVisitor();
  if (visitor.isBot) return { refused: { error: BAD_REQUEST, values, nonce: Date.now() } };
  if (!(await checkRateLimit(getPortalDb(), "act", visitor.ipHash)).allowed) {
    return { refused: { error: TRY_AGAIN, values, nonce: Date.now() } };
  }
  return { visitor };
}

/** The accept form's values, with the ticked add-ons as one comma-separated `chosen` entry. */
export function acceptFormValues(formData: FormData): Record<string, string> {
  const chosen = formData.getAll("chosen").filter((v): v is string => typeof v === "string");
  return { ...formValues(formData), chosen: chosen.join(",") };
}

/** Checks the accept form (the agree tick, then the shared schema). Used by the link and the portal. */
export function parseAcceptForm(
  formData: FormData,
  values: Record<string, string>,
): { data: LinkAcceptInput } | { state: FormState } {
  if (formData.get("agree") !== "on") {
    return {
      state: {
        fieldErrors: { agree: "Tick the box to accept this quotation." },
        values,
        nonce: Date.now(),
      },
    };
  }
  const chosen = formData.getAll("chosen").filter((v): v is string => typeof v === "string");
  const parsed = linkAcceptSchema.safeParse({
    acceptedBy: values.acceptedBy ?? "",
    startDate: values.startDate ?? "",
    chosenLineIds: chosen,
  });
  if (!parsed.success) {
    const fieldErrors = errorsFrom(parsed.error);
    // An error on a field the form does not show (a crafted request) would otherwise be invisible.
    const hidden = Object.keys(fieldErrors).some((k) => k !== "acceptedBy" && k !== "startDate");
    return {
      state: { fieldErrors, ...(hidden ? { error: BAD_REQUEST } : {}), values, nonce: Date.now() },
    };
  }
  return { data: parsed.data };
}
