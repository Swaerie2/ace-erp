"use server";

import {
  activateCustomer,
  addContact,
  anonymiseCustomer,
  addProperty,
  archiveCustomer,
  archiveProperty,
  clearManagedBy,
  contactSchema,
  createCustomer,
  customerSchema,
  DomainError,
  findDuplicateContacts,
  ForbiddenError,
  getDb,
  hasPropertyInput,
  HIERARCHY_MESSAGES,
  inTx,
  inviteContact,
  MANAGEMENT,
  PORTAL_ACCESS_MESSAGES,
  portalSignInUrl,
  propertySchema,
  removeContact,
  removeContactAccess,
  restoreCustomer,
  sendEmail,
  sendWelcomeEmails,
  setBillsToManager,
  setManagedBy,
  updateContact,
  updateCustomer,
  updateProperty,
  type HierarchyMessageKey,
} from "@ace/core";
import { redirect } from "next/navigation";
import { z } from "zod";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { errorsFrom, failure, formValues, withPrefix, type FormState } from "@/lib/form";

export async function createCustomerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const values = formValues(formData);

  const customer = customerSchema.safeParse(values);
  const contact = contactSchema.safeParse(withPrefix(values, "contact_"));
  // Any property detail means a property was meant, so a missing street is reported instead of
  // the details being dropped silently.
  const wantsProperty = hasPropertyInput(values, "property_");
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

/** One-click "Mark as active" (leads) or "Resume" (paused customers). */
export async function activateCustomerAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.parse(formData.get("id"));
  try {
    await inTx((tx) => activateCustomer(tx, actor, id));
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
  let code: "last-contact" | "generic" | undefined;
  try {
    await inTx((tx) => removeContact(tx, actor, contactId));
  } catch (error) {
    // Only a fixed code goes in the address bar; the contacts tab turns it into a message.
    const message = failure(error)?.error;
    code = message === "A customer needs at least one contact." ? "last-contact" : "generic";
  }
  redirect(
    code
      ? `/customers/${customerId}?tab=contacts&error=${code}`
      : `/customers/${customerId}?tab=contacts`,
  );
}

export async function savePropertyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const values = formValues(formData);
  const customerId = idSchema.safeParse(values.customerId);
  if (!customerId.success)
    return { error: "Something went wrong. Refresh the page and try again." };
  const propertyId = values.propertyId ? idSchema.safeParse(values.propertyId) : null;
  if (propertyId && !propertyId.success)
    return { error: "Something went wrong. Refresh the page and try again." };

  const parsed = propertySchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: errorsFrom(parsed.error), values, nonce: Date.now() };

  try {
    await inTx(async (tx) => {
      if (propertyId?.success) await updateProperty(tx, actor, propertyId.data, parsed.data);
      else await addProperty(tx, actor, customerId.data, parsed.data);
    });
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/customers/${customerId.data}?tab=properties`);
}

export async function archivePropertyAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const propertyId = idSchema.parse(formData.get("propertyId"));
  const customerId = idSchema.parse(formData.get("customerId"));
  try {
    await inTx((tx) => archiveProperty(tx, actor, propertyId));
  } catch (error) {
    failure(error);
  }
  redirect(`/customers/${customerId}?tab=properties`);
}

export async function anonymiseCustomerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireStaff(["OWNER"]);
  const actor = await toActor(staff);
  const values = formValues(formData);
  const id = idSchema.safeParse(values.id);
  if (!id.success)
    return { error: "Something went wrong. Refresh the page and try again.", nonce: Date.now() };

  try {
    // One transaction: the three updates and the audit entry succeed or fail together.
    await inTx((tx) => anonymiseCustomer(tx, actor, id.data, values.confirm ?? ""));
  } catch (error) {
    return failure(error);
  }
  redirect(`/customers/${id.data}`);
}

// --- managing agency and client portal access ------------------------------------------------------
// Every address-bar value below is a fixed code (never typed text); the pages turn the code into words.

/** The customer id from a form. A crafted or missing one goes back to the list, never to an error page. */
function customerIdOrList(formData: FormData): string {
  const parsed = idSchema.safeParse(formData.get("customerId"));
  if (!parsed.success) redirect("/customers");
  return parsed.data;
}

/** A refusal of the agency rules as a fixed code for the address bar (the page turns it back into words). */
function hierarchyCode(error: unknown): string {
  if (error instanceof ForbiddenError) redirect("/forbidden");
  if (error instanceof DomainError) {
    const keys = Object.keys(HIERARCHY_MESSAGES) as HierarchyMessageKey[];
    return keys.find((k) => HIERARCHY_MESSAGES[k] === error.message) ?? "generic";
  }
  throw error;
}

export async function setManagedByAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const customerId = customerIdOrList(formData);
  const agencyId = idSchema.safeParse(formData.get("agencyId"));
  let code = "linked";
  if (!agencyId.success) {
    code = "generic";
  } else {
    try {
      await inTx((tx) => setManagedBy(tx, actor, customerId, agencyId.data));
    } catch (error) {
      code = hierarchyCode(error);
    }
  }
  redirect(`/customers/${customerId}?tab=overview&link=${code}`);
}

export async function clearManagedByAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const customerId = customerIdOrList(formData);
  let code = "cleared";
  try {
    await inTx((tx) => clearManagedBy(tx, actor, customerId));
  } catch (error) {
    code = hierarchyCode(error);
  }
  redirect(`/customers/${customerId}?tab=overview&link=${code}`);
}

export async function setBillsToAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const customerId = customerIdOrList(formData);
  const choice = formData.get("billsTo");
  let code = "billing";
  if (choice !== "agency" && choice !== "complex") {
    code = "generic";
  } else {
    try {
      await inTx((tx) => setBillsToManager(tx, actor, customerId, choice === "agency"));
    } catch (error) {
      code = hierarchyCode(error);
    }
  }
  redirect(`/customers/${customerId}?tab=overview&link=${code}`);
}

/** A refusal of the portal access rules as a fixed code for the address bar. */
function portalCode(error: unknown): string {
  if (error instanceof ForbiddenError) redirect("/forbidden");
  if (error instanceof DomainError) {
    if (error.message === PORTAL_ACCESS_MESSAGES.noEmail) return "no-email";
    if (error.message === PORTAL_ACCESS_MESSAGES.archived) return "archived";
    return "portal-generic";
  }
  throw error;
}

/** Invite to portal: gives access, then sends the welcome after the change has committed. */
export async function inviteContactAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const customerId = customerIdOrList(formData);
  const contactId = idSchema.safeParse(formData.get("contactId"));
  let code = "portal-generic";
  if (contactId.success) {
    // Read before anything changes, so a missing setting stops here and not after the commit.
    const signInUrl = portalSignInUrl();
    try {
      const invite = await inTx((tx) => inviteContact(tx, actor, contactId.data));
      const { failed } = await sendWelcomeEmails(getDb(), [invite], {
        send: (message) => sendEmail(message),
        signInUrl,
      });
      code = failed > 0 ? "invite-failed" : "invited";
    } catch (error) {
      code = portalCode(error);
    }
  }
  redirect(`/customers/${customerId}?tab=contacts&error=${code}`);
}

export async function removeContactAccessAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const customerId = customerIdOrList(formData);
  const contactId = idSchema.safeParse(formData.get("contactId"));
  let code = "portal-generic";
  if (contactId.success) {
    code = "removed";
    try {
      await inTx((tx) => removeContactAccess(tx, actor, contactId.data));
    } catch (error) {
      code = portalCode(error);
    }
  }
  redirect(`/customers/${customerId}?tab=contacts&error=${code}`);
}
