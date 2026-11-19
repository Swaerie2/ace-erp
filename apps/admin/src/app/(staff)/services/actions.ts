"use server";

import {
  archiveService,
  createService,
  DuplicateServiceNameError,
  inTx,
  MANAGEMENT,
  moveService,
  restoreService,
  serviceSchema,
  updateService,
} from "@ace/core";
import { redirect } from "next/navigation";
import { z } from "zod";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { errorsFrom, failure, formValues, type FormState } from "@/lib/form";

const idSchema = z.uuid();
const direction = z.enum(["up", "down"]);

/** Add (no serviceId) or edit (with serviceId). */
export async function saveServiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const values = formValues(formData);
  const serviceId = values.serviceId ? idSchema.safeParse(values.serviceId) : null;
  if (serviceId && !serviceId.success) {
    return { error: "Something went wrong. Refresh the page and try again.", nonce: Date.now() };
  }

  const parsed = serviceSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: errorsFrom(parsed.error), values, nonce: Date.now() };

  try {
    await inTx(async (tx) => {
      if (serviceId?.success) await updateService(tx, actor, serviceId.data, parsed.data);
      else await createService(tx, actor, parsed.data);
    });
  } catch (error) {
    if (error instanceof DuplicateServiceNameError) {
      return { fieldErrors: { name: error.message }, values, nonce: Date.now() };
    }
    return failure(error, values);
  }
  redirect(values.fromArchived === "1" ? "/services?archived=1" : "/services");
}

export async function archiveServiceAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.parse(formData.get("id"));
  try {
    await inTx((tx) => archiveService(tx, actor, id));
  } catch (error) {
    failure(error);
  }
  redirect("/services");
}

export async function restoreServiceAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.parse(formData.get("id"));
  try {
    await inTx((tx) => restoreService(tx, actor, id));
  } catch (error) {
    failure(error);
  }
  redirect("/services?archived=1");
}

export async function moveServiceAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.parse(formData.get("id"));
  const dir = direction.parse(formData.get("direction"));
  try {
    await inTx((tx) => moveService(tx, actor, id, dir));
  } catch (error) {
    failure(error);
  }
  redirect("/services");
}
