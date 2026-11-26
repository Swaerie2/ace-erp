"use server";

import { DomainError, inPortalTx } from "@ace/core";
import { WELCOME_GONE, completeWelcome, welcomeSchema } from "@ace/core/portal";
import { redirect } from "next/navigation";
import { BAD_REQUEST, errorsFrom, formValues } from "@/lib/form";
import type { FormState } from "@/lib/form-state";
import { requireSession } from "@/lib/session";

export async function completeWelcomeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireSession({ allowUnwelcomed: true });
  const values = formValues(formData);
  const parsed = welcomeSchema.safeParse({
    contactId: values.contactId ?? "",
    name: values.name ?? "",
    phone: values.phone ?? "",
    billingLine1: values.billingLine1 ?? "",
    billingLine2: values.billingLine2 ?? "",
    billingSuburb: values.billingSuburb ?? "",
    billingCity: values.billingCity ?? "",
    billingPostalCode: values.billingPostalCode ?? "",
    consent: values.consent ?? "",
  });
  if (!parsed.success) {
    const fieldErrors = errorsFrom(parsed.error);
    // The contact id is a hidden field: an error on it (a crafted request) would otherwise be invisible.
    return {
      fieldErrors,
      ...("contactId" in fieldErrors ? { error: BAD_REQUEST } : {}),
      values,
      nonce: Date.now(),
    };
  }
  try {
    // The DomainError is NOT caught inside the callback: the contact is written before the customer, and
    // the rollback of the whole transaction relies on the throw reaching `inPortalTx`.
    await inPortalTx((tx) => completeWelcome(tx, session.scope, parsed.data));
  } catch (error) {
    if (error instanceof DomainError) {
      // A step that is already saved or gone is a plain notice with a way on to the quotes.
      return {
        error: error.message,
        ...(error.message === WELCOME_GONE ? { continueHref: "/" } : {}),
        values,
        nonce: Date.now(),
      };
    }
    throw error;
  }
  // The page shows the next contact to welcome, or goes home when all are done.
  redirect("/welcome");
}
