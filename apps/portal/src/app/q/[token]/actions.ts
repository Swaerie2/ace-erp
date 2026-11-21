"use server";

import {
  DomainError,
  acceptViaLink,
  checkRateLimit,
  declineViaLink,
  getPortalDb,
  inPortalTx,
  linkAcceptSchema,
  linkDeclineSchema,
} from "@ace/core";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getVisitor, type Visitor } from "@/lib/visitor";
import type { FormState } from "./form-state";

const TRY_AGAIN = "Too many attempts. Please wait ten minutes and try again.";
const BAD_REQUEST = "Something went wrong. Refresh the page and try again.";

function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function errorsFrom(error: z.ZodError): Record<string, string> {
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
async function guard(
  values: Record<string, string>,
): Promise<{ visitor: Visitor } | { refused: FormState }> {
  const visitor = await getVisitor();
  if (visitor.isBot) return { refused: { error: BAD_REQUEST, values, nonce: Date.now() } };
  if (!(await checkRateLimit(getPortalDb(), "act", visitor.ipHash)).allowed) {
    return { refused: { error: TRY_AGAIN, values, nonce: Date.now() } };
  }
  return { visitor };
}

/**
 * Every outcome except a typing mistake goes back to the page, which then shows the true state (accepted,
 * expired, withdrawn, not found...). This also makes a double tap harmless.
 */
const backToPage = (token: string): never => redirect(`/q/${encodeURIComponent(token)}`);

export async function acceptAction(
  token: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const chosen = formData.getAll("chosen").filter((v): v is string => typeof v === "string");
  const values: Record<string, string> = { ...formValues(formData), chosen: chosen.join(",") };
  const guarded = await guard(values);
  if ("refused" in guarded) return guarded.refused;
  if (formData.get("agree") !== "on") {
    return {
      fieldErrors: { agree: "Tick the box to accept this quotation." },
      values,
      nonce: Date.now(),
    };
  }
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
      fieldErrors,
      ...(hidden ? { error: BAD_REQUEST } : {}),
      values,
      nonce: Date.now(),
    };
  }
  try {
    await inPortalTx((tx) =>
      acceptViaLink(tx, token, parsed.data, {
        ip: guarded.visitor.ip,
        userAgent: guarded.visitor.userAgent,
      }),
    );
  } catch (error) {
    // Plain refusals (a start date in the past, a line that is not an add-on) are shown with the form.
    if (error instanceof DomainError) return { error: error.message, values, nonce: Date.now() };
    throw error;
  }
  return backToPage(token);
}

export async function declineAction(
  token: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData);
  const guarded = await guard(values);
  if ("refused" in guarded) return guarded.refused;
  const parsed = linkDeclineSchema.safeParse({ reason: values.reason ?? "" });
  if (!parsed.success) return { fieldErrors: errorsFrom(parsed.error), values, nonce: Date.now() };
  try {
    await inPortalTx((tx) =>
      declineViaLink(tx, token, parsed.data, {
        ip: guarded.visitor.ip,
        userAgent: guarded.visitor.userAgent,
      }),
    );
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, values, nonce: Date.now() };
    throw error;
  }
  return backToPage(token);
}
