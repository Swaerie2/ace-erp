"use server";

import {
  billingTimingSchema,
  DomainError,
  ForbiddenError,
  inTx,
  MANAGEMENT,
  setBillingTiming,
} from "@ace/core";
import { redirect } from "next/navigation";
import { z } from "zod";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";

const idSchema = z.uuid();

/**
 * For buttons that cannot show an error themselves: a refused role goes to /forbidden, a refusal the user can
 * fix becomes a fixed notice code (never typed text), anything unexpected is re-thrown.
 */
function refusal(error: unknown): void {
  if (error instanceof ForbiddenError) redirect("/forbidden");
  if (!(error instanceof DomainError)) throw error;
}

/** The Pre or Post switch on the customer's Invoices tab. */
export async function setBillingTimingAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.safeParse(formData.get("customerId"));
  if (!id.success) redirect("/customers");
  const timing = billingTimingSchema.safeParse(formData.get("billingTiming"));
  let code = "timing-saved";
  if (!timing.success) {
    code = "timing-generic";
  } else {
    try {
      await inTx((tx) => setBillingTiming(tx, actor, id.data, timing.data));
    } catch (error) {
      refusal(error);
      code = "timing-generic";
    }
  }
  redirect(`/customers/${id.data}?tab=invoices&notice=${code}`);
}
