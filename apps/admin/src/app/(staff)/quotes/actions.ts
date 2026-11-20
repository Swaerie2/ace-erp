"use server";

import {
  acceptQuote,
  acceptSchema,
  contactSchema,
  createCustomer,
  createQuote,
  customerSchema,
  declineQuote,
  declineSchema,
  deleteDraft,
  DraftConflictError,
  draftSchema,
  findDuplicateContacts,
  inTx,
  issueQuote,
  MANAGEMENT,
  markSent,
  propertySchema,
  reverseAcceptance,
  reviseQuote,
  saveDraft,
  SENT_METHODS,
  withdrawQuote,
} from "@ace/core";
import { redirect } from "next/navigation";
import { z } from "zod";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { errorsFrom, failure, formValues, type FormState } from "@/lib/form";

const idSchema = z.uuid();

/** Starts a draft for an existing customer and property, then opens the builder. */
export async function createQuoteAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const customerId = idSchema.parse(formData.get("customerId"));
  const propertyId = idSchema.parse(formData.get("propertyId"));
  let id: string;
  try {
    id = (await inTx((tx) => createQuote(tx, actor, { customerId, propertyId }))).id;
  } catch (error) {
    failure(error);
    // Only a fixed code goes in the address bar.
    redirect(`/quotes/new?customer=${customerId}&error=cannot`);
  }
  redirect(`/quotes/${id}`);
}

/** A new prospect on site: creates a lead (one contact, one property) and starts its quote. */
export async function quickAddQuoteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const values = formValues(formData);

  const customer = customerSchema.safeParse({
    type: values.type,
    displayName: values.displayName,
    status: "LEAD",
  });
  const contact = contactSchema.safeParse({
    name: values.displayName,
    email: values.email,
    phone: values.phone,
    receivesQuotes: "on",
    receivesInvoices: "on",
  });
  const property = propertySchema.safeParse({
    label: "Main property",
    addressLine1: values.addressLine1,
    suburb: values.suburb,
    city: values.city,
  });
  if (!customer.success || !contact.success || !property.success) {
    const customerErrors: Record<string, string> = customer.success
      ? {}
      : errorsFrom(customer.error);
    const { name: nameError, ...otherContactErrors } = contact.success
      ? ({} as Record<string, string>)
      : errorsFrom(contact.error);
    const fieldErrors: Record<string, string> = {
      ...customerErrors,
      ...otherContactErrors,
      ...(property.success ? {} : errorsFrom(property.error)),
    };
    // The contact's name is the prospect's name, so a name problem belongs to that one box.
    const displayNameError = customerErrors.displayName ?? nameError;
    if (displayNameError) fieldErrors.displayName = displayNameError;
    return { fieldErrors, values, nonce: Date.now() };
  }

  let id: string;
  try {
    const result = await inTx(async (tx) => {
      // A warning, not a block: the same email or phone on another customer.
      if (values.confirmDuplicates !== "1") {
        const duplicates = await findDuplicateContacts(tx, actor, {
          emails: contact.data.email ? [contact.data.email] : [],
          phones: contact.data.phone ? [contact.data.phone] : [],
        });
        if (duplicates.length > 0) return { duplicates } as const;
      }
      const created = await createCustomer(tx, actor, {
        customer: customer.data,
        contact: contact.data,
        property: property.data,
      });
      const site = await tx.property.findFirstOrThrow({ where: { customerId: created.id } });
      const quote = await createQuote(tx, actor, { customerId: created.id, propertyId: site.id });
      return { id: quote.id } as const;
    });
    if ("duplicates" in result) return { duplicates: result.duplicates, values, nonce: Date.now() };
    id = result.id;
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/quotes/${id}`);
}

type SaveResult = { ok: true; version: number } | { ok: false; conflict: boolean; error: string };

/** Called by the builder about 800 ms after the last change. `payload` is a DraftInput as JSON. */
export async function saveDraftAction(quoteId: string, payload: string): Promise<SaveResult> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.safeParse(quoteId);
  if (!id.success) return { ok: false, conflict: false, error: "Refresh the page and try again." };
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { ok: false, conflict: false, error: "Refresh the page and try again." };
  }
  const parsed = draftSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      conflict: false,
      error: parsed.error.issues[0]?.message ?? "Some details are not valid.",
    };
  }
  try {
    const { version } = await inTx((tx) => saveDraft(tx, actor, id.data, parsed.data));
    return { ok: true, version };
  } catch (error) {
    if (error instanceof DraftConflictError) {
      return { ok: false, conflict: true, error: error.message };
    }
    const state = failure(error); // a refused role redirects; anything unexpected is rethrown
    return { ok: false, conflict: false, error: state?.error ?? "Could not save." };
  }
}

/** Finish and issue. An incomplete quote comes back as a list of problems, one per line. */
export async function issueQuoteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { error: "Something went wrong. Refresh the page and try again." };
  try {
    await inTx((tx) => issueQuote(tx, actor, id.data));
  } catch (error) {
    return failure(error);
  }
  redirect(`/quotes/${id.data}`);
}

export async function deleteDraftAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.parse(formData.get("id"));
  try {
    await inTx((tx) => deleteDraft(tx, actor, id));
  } catch (error) {
    failure(error);
  }
  redirect("/quotes");
}

const sentMethod = z.enum(SENT_METHODS);
const BAD_REQUEST = "Something went wrong. Refresh the page and try again.";

export async function markSentAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.parse(formData.get("id"));
  const method = sentMethod.parse(formData.get("method"));
  try {
    await inTx((tx) => markSent(tx, actor, id, method));
  } catch (error) {
    failure(error);
  }
  redirect(`/quotes/${id}`);
}

export async function acceptQuoteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const chosen = formData.getAll("chosen").filter((v): v is string => typeof v === "string");
  // The add-on ticks come back with every failure so the form can tick them again.
  const values: Record<string, string> = { ...formValues(formData), chosen: chosen.join(",") };
  const id = idSchema.safeParse(values.id);
  if (!id.success) return { error: BAD_REQUEST, nonce: Date.now() };
  const parsed = acceptSchema.safeParse({
    method: values.method,
    acceptedBy: values.acceptedBy,
    startDate: values.startDate,
    chosenLineIds: chosen,
    note: values.note ?? "",
  });
  if (!parsed.success) return { fieldErrors: errorsFrom(parsed.error), values, nonce: Date.now() };
  let flag: "PAUSED" | "ARCHIVED" | null;
  try {
    flag = (await inTx((tx) => acceptQuote(tx, actor, id.data, parsed.data))).customerFlag;
  } catch (error) {
    return failure(error, values);
  }
  redirect(flag ? `/quotes/${id.data}?notice=${flag.toLowerCase()}` : `/quotes/${id.data}`);
}

export async function declineQuoteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const values = formValues(formData);
  const id = idSchema.safeParse(values.id);
  if (!id.success) return { error: BAD_REQUEST, nonce: Date.now() };
  const parsed = declineSchema.safeParse({ reason: values.reason ?? "" });
  if (!parsed.success) return { fieldErrors: errorsFrom(parsed.error), values, nonce: Date.now() };
  try {
    await inTx((tx) => declineQuote(tx, actor, id.data, parsed.data));
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/quotes/${id.data}`);
}

export async function withdrawQuoteAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.parse(formData.get("id"));
  try {
    await inTx((tx) => withdrawQuote(tx, actor, id));
  } catch (error) {
    failure(error);
  }
  redirect(`/quotes/${id}`);
}

/** Copies the quote into a new draft and opens the builder on it. */
export async function reviseQuoteAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.parse(formData.get("id"));
  let draftId: string;
  try {
    draftId = (await inTx((tx) => reviseQuote(tx, actor, id))).id;
  } catch (error) {
    failure(error);
    redirect(`/quotes/${id}`);
  }
  redirect(`/quotes/${draftId}`);
}

export async function reverseAcceptanceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireStaff(["OWNER"]);
  const actor = await toActor(staff);
  const values = formValues(formData);
  const id = idSchema.safeParse(values.id);
  if (!id.success) return { error: BAD_REQUEST, nonce: Date.now() };
  try {
    await inTx((tx) => reverseAcceptance(tx, actor, id.data, values.note ?? ""));
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/quotes/${id.data}`);
}
