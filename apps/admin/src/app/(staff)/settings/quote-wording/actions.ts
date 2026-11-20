"use server";

import { inTx, updateQuoteWording, wordingSchema } from "@ace/core";
import { redirect } from "next/navigation";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { failure, type FormState } from "@/lib/form";

const AREAS: Record<string, string> = {
  tagline: "Tagline",
  standardExclusions: "Standard exclusions",
  monthlyTerms: "Monthly terms",
  onceOffTerms: "Once-off terms",
  commonTerms: "General terms",
  everyVisitPoints: "Every visit points",
  defaultValidityDays: "Default validity",
  registrationNumber: "Registration number",
  phone: "Phone",
  email: "Email",
  website: "Website",
};

export async function saveWordingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(["OWNER"]);
  const actor = await toActor(staff);
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { error: "Something went wrong. Refresh the page and try again.", nonce: Date.now() };
  }
  const parsed = wordingSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const area = AREAS[String(issue?.path[0] ?? "")] ?? "Wording";
    const row = typeof issue?.path[1] === "number" ? ` (item ${issue.path[1] + 1})` : "";
    return { error: `${area}${row}: ${issue?.message ?? "not valid."}`, nonce: Date.now() };
  }
  try {
    await inTx((tx) => updateQuoteWording(tx, actor, parsed.data));
  } catch (error) {
    return failure(error);
  }
  redirect("/settings/quote-wording?saved=1");
}
