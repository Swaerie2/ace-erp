"use server";

import { DomainError, inPortalTx, linkDeclineSchema } from "@ace/core";
import { acceptPortalQuote, declinePortalQuote } from "@ace/core/portal";
import { redirect } from "next/navigation";
import { acceptFormValues, errorsFrom, formValues, guardAction, parseAcceptForm } from "@/lib/form";
import type { FormState } from "@/lib/form-state";
import { grantPortalAccessLater } from "@/lib/portal-access";
import { requireSession } from "@/lib/session";

/** Every outcome except a typing mistake goes back to the quote page, which shows the true state. */
const backToQuote = (quoteId: string): never => redirect(`/quotes/${encodeURIComponent(quoteId)}`);

export async function acceptPortalQuoteAction(
  quoteId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireSession();
  const values = acceptFormValues(formData);
  const guarded = await guardAction(values);
  if ("refused" in guarded) return guarded.refused;
  const parsed = parseAcceptForm(formData, values);
  if ("state" in parsed) return parsed.state;
  let result: Awaited<ReturnType<typeof acceptPortalQuote>>;
  try {
    result = await inPortalTx((tx) =>
      acceptPortalQuote(tx, session.scope, quoteId, parsed.data, {
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
  return backToQuote(quoteId);
}

export async function declinePortalQuoteAction(
  quoteId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireSession();
  const values = formValues(formData);
  const guarded = await guardAction(values);
  if ("refused" in guarded) return guarded.refused;
  const parsed = linkDeclineSchema.safeParse({ reason: values.reason ?? "" });
  if (!parsed.success) return { fieldErrors: errorsFrom(parsed.error), values, nonce: Date.now() };
  try {
    await inPortalTx((tx) => declinePortalQuote(tx, session.scope, quoteId, parsed.data));
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, values, nonce: Date.now() };
    throw error;
  }
  return backToQuote(quoteId);
}
