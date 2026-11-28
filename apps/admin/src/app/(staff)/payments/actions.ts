"use server";

import {
  allocatePayment,
  allocationFormSchema,
  DomainError,
  ForbiddenError,
  inTx,
  INVOICE_MESSAGES,
  MANAGEMENT,
  paymentInputFromForm,
  reasonSchema,
  recordPayment,
  todaySA,
  unallocatePayment,
  voidPayment,
} from "@ace/core";
import { redirect } from "next/navigation";
import { z } from "zod";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { failure, formValues, type FormState } from "@/lib/form";

const idSchema = z.uuid();
const BAD_REQUEST = "Something went wrong. Refresh the page and try again.";
/** Core's words when the payer has been anonymised (lockCustomer and findEditableCustomer). */
const ANONYMISED = "This customer has been anonymised and cannot be changed.";

/**
 * For buttons that cannot show an error themselves: a refused role goes to /forbidden, a refusal becomes a
 * fixed notice code (never typed text, never a reference or note), anything unexpected is re-thrown.
 */
function codeFor(error: unknown): string {
  if (error instanceof ForbiddenError) redirect("/forbidden");
  if (!(error instanceof DomainError)) throw error;
  if (error.message === INVOICE_MESSAGES.paymentVoided) return "voided-already";
  if (error.message === ANONYMISED) return "anonymised";
  return "cannot";
}

/**
 * "Record payment". Every field goes through core's form parser (dates, amounts in cents, lengths, special
 * characters); recordPayment checks the allocations again after locking.
 */
export async function recordPaymentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const values = formValues(formData);
  const parsed = paymentInputFromForm(values, todaySA());
  if (!parsed.ok) {
    const { form, ...fieldErrors } = parsed.fieldErrors;
    return {
      error: form ?? "Check the boxes marked below.",
      fieldErrors,
      values,
      nonce: Date.now(),
    };
  }
  let id: string;
  try {
    id = (await inTx((tx) => recordPayment(tx, actor, parsed.input))).id;
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/payments/${id}?notice=${parsed.input.reportId ? "confirmed" : "recorded"}`);
}

/** "Allocate" on a payment: part of what is not allocated yet, to one invoice. */
export async function allocateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const values = formValues(formData);
  const parsed = allocationFormSchema.safeParse({
    paymentId: values.paymentId ?? "",
    invoiceId: values.invoiceId ?? "",
    amount: values.amount ?? "",
  });
  if (!parsed.success) {
    const amountIssue = parsed.error.issues.find((i) => i.path[0] === "amount");
    if (!amountIssue) return { error: BAD_REQUEST, values, nonce: Date.now() };
    return {
      error: "Check the box marked below.",
      fieldErrors: { amount: amountIssue.message },
      values,
      nonce: Date.now(),
    };
  }
  try {
    await inTx((tx) => allocatePayment(tx, actor, parsed.data));
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/payments/${parsed.data.paymentId}?notice=allocated`);
}

/** "Remove" on one allocation: the money is credit on account again. */
export async function unallocateAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const paymentId = idSchema.safeParse(formData.get("paymentId"));
  if (!paymentId.success) redirect("/payments");
  const allocationId = idSchema.safeParse(formData.get("allocationId"));
  if (!allocationId.success) redirect(`/payments/${paymentId.data}?notice=cannot`);
  let code = "unallocated";
  try {
    await inTx((tx) => unallocatePayment(tx, actor, allocationId.data));
  } catch (error) {
    code = codeFor(error);
  }
  redirect(`/payments/${paymentId.data}?notice=${code}`);
}

/** "Void the payment", for example a bounced EFT. The reason goes through core's reason schema. */
export async function voidPaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const values = formValues(formData);
  const paymentId = idSchema.safeParse(values.paymentId);
  if (!paymentId.success) return { error: BAD_REQUEST, nonce: Date.now() };
  const reason = reasonSchema.safeParse(values.reason ?? "");
  if (!reason.success) {
    return {
      error: "Check the box marked below.",
      fieldErrors: { reason: reason.error.issues[0]?.message ?? "Say why in a few words." },
      values,
      nonce: Date.now(),
    };
  }
  try {
    await inTx((tx) => voidPayment(tx, actor, paymentId.data, reason.data));
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/payments/${paymentId.data}?notice=voided`);
}
