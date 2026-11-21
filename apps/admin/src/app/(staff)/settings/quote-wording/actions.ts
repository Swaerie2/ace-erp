"use server";

import { inTx, updateQuoteWording, wordingSchema } from "@ace/core";
import { redirect } from "next/navigation";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { failure, type FormState } from "@/lib/form";

/** Names as they appear on the page, so an error points at a heading the owner can see. */
const AREAS: Record<string, string> = {
  tagline: "Tagline",
  standardExclusions: "Standard exclusions",
  monthlyTerms: "Monthly contract terms",
  onceOffTerms: "Once-off terms",
  commonTerms: "General terms",
  everyVisitPoints: "Every visit on record",
  defaultValidityDays: "Default days a quote is valid",
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
    const key = String(issue?.path[0] ?? "");
    // The two text boxes list one line per entry; the clause lists show "Item N" on each card.
    const noun = key === "standardExclusions" || key === "everyVisitPoints" ? "line" : "item";
    const row = typeof issue?.path[1] === "number" ? ` (${noun} ${issue.path[1] + 1})` : "";
    return { error: `${area}${row}: ${issue?.message ?? "not valid."}`, nonce: Date.now() };
  }
  try {
    await inTx((tx) => updateQuoteWording(tx, actor, parsed.data));
  } catch (error) {
    return failure(error);
  }
  redirect("/settings/quote-wording?saved=1");
}
