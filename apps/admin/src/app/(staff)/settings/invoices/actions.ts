"use server";

import { inTx, invoiceSettingsFormSchema, updateInvoiceSettings } from "@ace/core";
import { redirect } from "next/navigation";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { errorsFrom, failure, formValues, type FormState } from "@/lib/form";

export async function saveInvoiceSettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireStaff(["OWNER"]);
  const actor = await toActor(staff);
  const values = formValues(formData);
  const parsed = invoiceSettingsFormSchema.safeParse({
    bankName: values.bankName ?? "",
    accountHolder: values.accountHolder ?? "",
    accountNumber: values.accountNumber ?? "",
    branchCode: values.branchCode ?? "",
    accountType: values.accountType ?? "",
    onceOffDueDays: values.onceOffDueDays ?? "",
    lateFee: values.lateFee ?? "",
  });
  if (!parsed.success) return { fieldErrors: errorsFrom(parsed.error), values, nonce: Date.now() };
  try {
    await inTx((tx) => updateInvoiceSettings(tx, actor, parsed.data));
  } catch (error) {
    return failure(error, values);
  }
  redirect("/settings/invoices?saved=1");
}
