"use server";

import {
  contactSchema,
  createCustomer,
  customerSchema,
  findDuplicateContacts,
  inTx,
  propertySchema,
} from "@ace/core";
import { redirect } from "next/navigation";
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
