import { assertRole, DomainError, OWNER_ONLY, type Actor } from "./access";
import { parseCustomerNumber } from "./number";
import { logCustomerEvent, type Store } from "./store";

/** Everything held about one customer (POPIA "what do you hold about me"). Owner only. */
export async function exportCustomerData(store: Store, actor: Actor, id: string) {
  assertRole(actor, OWNER_ONLY);
  const customer = await store.customer.findUnique({
    where: { id },
    include: { contacts: true, properties: true },
  });
  if (!customer) throw new DomainError("That customer could not be found.");
  const activity = await store.auditLog.findMany({
    where: { entityType: "customer", entityId: id },
    orderBy: { at: "asc" },
    select: { at: true, action: true, actorType: true },
  });
  await logCustomerEvent(store, actor, "customer.exported", id);
  return { exportedAt: new Date().toISOString(), customer, activity };
}

/**
 * Permanently removes a customer's personal details but keeps the record, its number and any
 * money amounts, so old invoices still add up. Owner only, cannot be undone.
 * Call it inside one transaction (`inTx`) so the three updates succeed or fail together.
 */
export async function anonymiseCustomer(
  store: Store,
  actor: Actor,
  id: string,
  confirmNumber: string,
): Promise<void> {
  assertRole(actor, OWNER_ONLY);
  const customer = await store.customer.findUnique({ where: { id } });
  if (!customer) throw new DomainError("That customer could not be found.");
  if (customer.anonymisedAt) throw new DomainError("This customer is already anonymised.");
  if (parseCustomerNumber(confirmNumber) !== customer.number) {
    throw new DomainError("Type the customer number exactly as shown to confirm.");
  }

  const now = new Date();
  await store.customer.update({
    where: { id },
    data: {
      displayName: "Anonymised customer",
      companyName: null,
      registrationNumber: null,
      billingLine1: null,
      billingLine2: null,
      billingSuburb: null,
      billingCity: null,
      billingPostalCode: null,
      sourceNote: null,
      notes: null,
      consentAt: null,
      consentSource: null,
      consentNote: null,
      status: "ARCHIVED",
      statusBeforeArchive: null,
      archivedAt: customer.archivedAt ?? now,
      anonymisedAt: now,
    },
  });
  await store.contact.updateMany({
    where: { customerId: id },
    data: { name: "Anonymised contact", role: null, email: null, phone: null, portalAccess: false },
  });
  await store.property.updateMany({
    where: { customerId: id },
    data: {
      label: "Anonymised property",
      addressLine1: "Anonymised",
      addressLine2: null,
      suburb: null,
      city: null,
      postalCode: null,
      mapUrl: null,
      accessNotes: null,
      terrainNotes: null,
      extrasNote: null,
    },
  });
  await logCustomerEvent(store, actor, "customer.anonymised", id);
}
