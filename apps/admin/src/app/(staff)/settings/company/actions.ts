"use server";

import {
  companyAddressInputFromForm,
  inTx,
  MAX_LOGO_BYTES,
  removeCompanyLogo,
  setCompanyLogo,
  updateCompanyAddress,
} from "@ace/core";
import { redirect } from "next/navigation";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { failure, formValues, type FormState } from "@/lib/form";

const CHOOSE_FIRST = "Choose a PNG or JPEG picture first.";
const TOO_BIG = "That picture is larger than 500 KB. Make it smaller and try again.";

/** Owner only. Stores the uploaded picture as the company logo. The file name and bytes are never logged. */
export async function saveCompanyLogoAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireStaff(["OWNER"]);
  const actor = await toActor(staff);
  const file = formData.get("logo");
  const nonce = Date.now();
  if (!(file instanceof File) || file.size === 0) {
    return { fieldErrors: { logo: CHOOSE_FIRST }, nonce };
  }
  // Refused before the file is read into memory.
  if (file.size > MAX_LOGO_BYTES) return { fieldErrors: { logo: TOO_BIG }, nonce };
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    await inTx((tx) => setCompanyLogo(tx, actor, bytes));
  } catch (error) {
    // A refused picture (wrong kind, damaged, wrong size) is shown beside the file field.
    const state = failure(error);
    return { fieldErrors: { logo: state?.error ?? CHOOSE_FIRST }, nonce };
  }
  redirect("/settings/company?saved=logo");
}

/** Owner only. Removes the company logo; documents are then made without one. */
export async function removeCompanyLogoAction(): Promise<void> {
  const staff = await requireStaff(["OWNER"]);
  const actor = await toActor(staff);
  try {
    await inTx((tx) => removeCompanyLogo(tx, actor));
  } catch (error) {
    failure(error); // a ForbiddenError goes to /forbidden; anything else is thrown
    redirect("/settings/company?saved=failed");
  }
  redirect("/settings/company?saved=removed");
}

/** Owner only. Saves the company address printed on documents. */
export async function saveCompanyAddressAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireStaff(["OWNER"]);
  const actor = await toActor(staff);
  const values = formValues(formData);
  const parsed = companyAddressInputFromForm(formData);
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors, values, nonce: Date.now() };
  try {
    await inTx((tx) => updateCompanyAddress(tx, actor, parsed.input));
  } catch (error) {
    return failure(error, values);
  }
  redirect("/settings/company?saved=address");
}
