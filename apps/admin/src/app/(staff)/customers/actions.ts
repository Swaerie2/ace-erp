"use server";

import {
  addContact,
  archiveCustomer,
  contactSchema,
  createCustomer,
  customerSchema,
  findDuplicateContacts,
  inTx,
  propertySchema,
  removeContact,
  restoreCustomer,
  updateContact,
  updateCustomer,
} from "@ace/core";
import { redirect } from "next/navigation";
import { z } from "zod";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { errorsFrom, failure, formValues, withPrefix, type FormState } from "@/lib/form";

const MANAGEMENT = ["OWNER", "MANAGER"] as const;

export async function createCustomerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const values = formValues(formData);

  const customer = customerSchema.safeParse(values);
  const contact = contactSchema.safeParse(withPrefix(values, "contact_"));
  const wantsProperty = Boolean(values.property_addressLine1?.trim());
  const property = wantsProperty ? propertySchema.safeParse(withPrefix(values, "property_")) : null;

  const fieldErrors = {
    ...(customer.success ? {} : errorsFrom(customer.error)),
    ...(contact.success ? {} : errorsFrom(contact.error, "contact_")),
    ...(property && !property.success ? errorsFrom(property.error, "property_") : {}),
  };
  if (!customer.success || !contact.success || (property && !property.success)) {
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
        property: property?.success ? property.data : undefined,
      });
      return { id: created.id } as const;
    });
    if ("duplicates" in result) return { duplicates: result.duplicates, values, nonce: Date.now() };
    id = result.id;
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/customers/${id}`);
}

const idSchema = z.uuid();

export async function updateCustomerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const values = formValues(formData);
  const id = idSchema.safeParse(values.id);
  if (!id.success) return { error: "Something went wrong. Refresh the page and try again." };

  const customer = customerSchema.safeParse(values);
  if (!customer.success)
    return { fieldErrors: errorsFrom(customer.error), values, nonce: Date.now() };

  try {
    await inTx((tx) => updateCustomer(tx, actor, id.data, customer.data));
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/customers/${id.data}`);
}

export async function archiveCustomerAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.parse(formData.get("id"));
  try {
    await inTx((tx) => archiveCustomer(tx, actor, id));
  } catch (error) {
    failure(error);
  }
  redirect(`/customers/${id}`);
}

export async function restoreCustomerAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.parse(formData.get("id"));
  try {
    await inTx((tx) => restoreCustomer(tx, actor, id));
  } catch (error) {
    failure(error);
  }
  redirect(`/customers/${id}`);
}

export async function saveContactAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const values = formValues(formData);
  const customerId = idSchema.safeParse(values.customerId);
  if (!customerId.success)
    return { error: "Something went wrong. Refresh the page and try again." };
  const contactId = values.contactId ? idSchema.safeParse(values.contactId) : null;
  if (contactId && !contactId.success)
    return { error: "Something went wrong. Refresh the page and try again." };

  const parsed = contactSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: errorsFrom(parsed.error), values, nonce: Date.now() };

  try {
    const outcome = await inTx(async (tx) => {
      if (values.confirmDuplicates !== "1") {
        const duplicates = await findDuplicateContacts(tx, actor, {
          emails: parsed.data.email ? [parsed.data.email] : [],
          phones: parsed.data.phone ? [parsed.data.phone] : [],
          excludeCustomerId: customerId.data,
        });
        if (duplicates.length > 0) return { duplicates } as const;
      }
      if (contactId?.success) await updateContact(tx, actor, contactId.data, parsed.data);
      else await addContact(tx, actor, customerId.data, parsed.data);
      return { saved: true } as const;
    });
    if ("duplicates" in outcome)
      return { duplicates: outcome.duplicates, values, nonce: Date.now() };
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/customers/${customerId.data}?tab=contacts`);
}

export async function removeContactAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const contactId = idSchema.parse(formData.get("contactId"));
  const customerId = idSchema.parse(formData.get("customerId"));
  let notice: string | undefined;
  try {
    await inTx((tx) => removeContact(tx, actor, contactId));
  } catch (error) {
    // e.g. "A customer needs at least one contact." Show it on the page.
    notice = failure(error)?.error ?? "Could not remove that contact.";
  }
  redirect(
    notice
      ? `/customers/${customerId}?tab=contacts&error=${encodeURIComponent(notice)}`
      : `/customers/${customerId}?tab=contacts`,
  );
}
