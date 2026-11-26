import { clientParty } from "../audit";
import { DomainError } from "../customers/access";
import {
  changedFields,
  findEditableCustomerNarrow,
  lockCustomer,
  logCustomerEventAs,
} from "../customers/store";
import type { Db } from "../db";
import type { PortalScope } from "./scope";
import type { WelcomeInput } from "./welcome-schema";

export const WELCOME_GONE =
  "This step is already saved or no longer available. Continue to your quotes.";

export type WelcomeStep = {
  contactId: string;
  name: string;
  phone: string | null;
  email: string;
  customerName: string;
  isCompany: boolean;
  billing: {
    billingLine1: string | null;
    billingLine2: string | null;
    billingSuburb: string | null;
    billingCity: string | null;
    billingPostalCode: string | null;
  };
  consentRecorded: boolean;
  /** Contacts still to welcome, this one included. */
  remaining: number;
};

/** The next contact of this person still to welcome (one at a time), or null when all are done. */
export async function getWelcomeStep(
  store: Pick<Db, "contact">,
  scope: PortalScope,
): Promise<WelcomeStep | null> {
  const pending = scope.contacts.filter((c) => !c.welcomed).map((c) => c.id);
  if (pending.length === 0) return null;
  const contact = await store.contact.findFirst({
    where: { id: { in: pending }, email: scope.email, portalAccess: true, portalWelcomedAt: null },
    orderBy: { id: "asc" },
    select: {
      id: true,
      name: true,
      phone: true,
      customer: {
        select: {
          displayName: true,
          type: true,
          billingLine1: true,
          billingLine2: true,
          billingSuburb: true,
          billingCity: true,
          billingPostalCode: true,
          consentAt: true,
        },
      },
    },
  });
  if (!contact) return null;
  const c = contact.customer;
  return {
    contactId: contact.id,
    name: contact.name,
    phone: contact.phone,
    email: scope.email,
    customerName: c.displayName,
    isCompany: c.type === "COMPANY",
    billing: {
      billingLine1: c.billingLine1,
      billingLine2: c.billingLine2,
      billingSuburb: c.billingSuburb,
      billingCity: c.billingCity,
      billingPostalCode: c.billingPostalCode,
    },
    consentRecorded: c.consentAt !== null,
    remaining: pending.length,
  };
}

/**
 * Saves the welcome for one contact of the signed-in person: their name and phone, the billing address of
 * the contact's OWN customer (an agency's own address, never a complex's), and the privacy consent on that
 * customer if none is recorded yet. Lock order: the customer, then the contact is re-read under the lock.
 *
 * The `ace_portal` role may update any contact and customer row (its policies are `USING true`), so every
 * write names the signed-in person's own row: the contact by id AND customer AND email AND access AND not
 * yet welcomed, the customer by the id read from that contact. Call inside a transaction.
 */
export async function completeWelcome(
  store: Pick<Db, "contact" | "customer" | "auditLog">,
  scope: PortalScope,
  input: WelcomeInput,
  now: Date = new Date(),
): Promise<void> {
  const target = scope.contacts.find((c) => c.id === input.contactId);
  if (!target) throw new DomainError(WELCOME_GONE);
  const ownContact = {
    id: target.id,
    customerId: target.customerId,
    email: scope.email,
    portalAccess: true,
    portalWelcomedAt: null,
  };
  // Unlocked check first: a contact that is not the person's must not even cause a lock on its customer.
  if (!(await store.contact.findFirst({ where: ownContact, select: { id: true } }))) {
    throw new DomainError(WELCOME_GONE);
  }
  await findEditableCustomerNarrow(store, target.customerId);
  await lockCustomer(store, target.customerId);
  const contact = await store.contact.findFirst({
    where: ownContact,
    select: { id: true, name: true, phone: true },
  });
  if (!contact) throw new DomainError(WELCOME_GONE);
  const customer = await store.customer.findUniqueOrThrow({
    where: { id: target.customerId },
    select: {
      status: true,
      billingLine1: true,
      billingLine2: true,
      billingSuburb: true,
      billingCity: true,
      billingPostalCode: true,
      consentAt: true,
    },
  });
  if (customer.status === "ARCHIVED") throw new DomainError(WELCOME_GONE);

  const person = { name: input.name, phone: input.phone };
  const billing = {
    billingLine1: input.billingLine1,
    billingLine2: input.billingLine2,
    billingSuburb: input.billingSuburb,
    billingCity: input.billingCity,
    billingPostalCode: input.billingPostalCode,
  };
  // Consent is recorded only if none is on file; an earlier consent (and its source) is kept as it was.
  const recordConsent = customer.consentAt === null;
  const contactDone = await store.contact.updateMany({
    where: ownContact,
    data: { ...person, portalWelcomedAt: now },
  });
  if (contactDone.count !== 1) throw new DomainError(WELCOME_GONE);
  const customerDone = await store.customer.updateMany({
    where: { id: target.customerId, anonymisedAt: null, status: { not: "ARCHIVED" } },
    data: { ...billing, ...(recordConsent ? { consentAt: now, consentSource: "portal" } : {}) },
  });
  if (customerDone.count !== 1) throw new DomainError(WELCOME_GONE);
  await logCustomerEventAs(
    store,
    clientParty(target.customerId),
    "customer.portal_welcomed",
    target.customerId,
    {
      contactId: contact.id,
      changed: [...changedFields(contact, person), ...changedFields(customer, billing)],
      consentRecorded: recordConsent,
    },
  );
}
