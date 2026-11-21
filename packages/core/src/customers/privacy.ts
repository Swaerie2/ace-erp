import { assertRole, DomainError, OWNER_ONLY, type Actor } from "./access";
import { parseCustomerNumber } from "./number";
import { lockCustomer, logCustomerEvent, type Store } from "./store";

/** Everything held about one customer (POPIA "what do you hold about me"). Owner only. */
export async function exportCustomerData(store: Store, actor: Actor, id: string) {
  assertRole(actor, OWNER_ONLY);
  const customer = await store.customer.findUnique({
    where: { id },
    include: {
      contacts: true,
      properties: true,
      // The live client link code is a credential, not something held about the customer.
      quotes: { omit: { linkToken: true }, include: { lines: true, scopeItems: true } },
    },
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
 * Call it inside one transaction (`inTx`) so the updates succeed or fail together.
 *
 * Order matters. The customer row is what carries `anonymisedAt`, so it is written LAST: if
 * anything fails part-way outside a transaction, the customer is still not marked anonymised and
 * the call can simply be repeated. The customer is locked first so an edit that is in flight
 * finishes (or is refused) before the scrubbing starts, and cannot write personal data back after.
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
  await lockCustomer(store, id);

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
      grassType: null,
      terrainNotes: null,
    },
  });

  // Quotes carry a frozen copy of the recipient and site, plus typed names, notes and reasons, and the private link code.
  // The amounts, lines, wording and content fingerprint stay.
  await store.quote.updateMany({
    where: { customerId: id },
    data: {
      internalNote: null,
      recipientName: null,
      recipientEmail: null,
      recipientPhone: null,
      siteLabel: null,
      siteAddress: null,
      acceptedByName: null,
      acceptanceNote: null,
      acceptedIp: null,
      acceptedUserAgent: null,
      declineReason: null,
      reversalNote: null,
      linkToken: null,
    },
  });

  const now = new Date();
  // Conditional, so two anonymise calls racing each other cannot both succeed.
  const { count } = await store.customer.updateMany({
    where: { id, anonymisedAt: null },
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
  if (count !== 1) throw new DomainError("This customer is already anonymised.");
  await logCustomerEvent(store, actor, "customer.anonymised", id);
}
