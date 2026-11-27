"use server";

import {
  DomainError,
  acceptViaLink,
  declineViaLink,
  inPortalTx,
  linkDeclineSchema,
} from "@ace/core";
import { redirect } from "next/navigation";
import { acceptFormValues, errorsFrom, formValues, guardAction, parseAcceptForm } from "@/lib/form";
import type { FormState } from "@/lib/form-state";
import { grantPortalAccessLater } from "@/lib/portal-access";

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
  const values = acceptFormValues(formData);
  const guarded = await guardAction(values);
  if ("refused" in guarded) return guarded.refused;
  const parsed = parseAcceptForm(formData, values);
  if ("state" in parsed) return parsed.state;
  let result: Awaited<ReturnType<typeof acceptViaLink>>;
  try {
    result = await inPortalTx((tx) =>
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
  // The acceptance has committed: portal access and the welcome emails follow after the response.
  if (result.outcome === "ACCEPTED") grantPortalAccessLater(result.quoteId);
  return backToPage(token);
}

export async function declineAction(
  token: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData);
  const guarded = await guardAction(values);
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
