import type { Db } from "../db";

declare const SCOPE_BRAND: unique symbol;

/** One contact the signed-in email belongs to (portal access on, customer neither archived nor anonymised). */
export type ScopeContact = { id: string; customerId: string; name: string; welcomed: boolean };

/**
 * What a signed-in email may see, computed from live data on every request. Branded so that only
 * `loadPortalScope` (and tests) can make one: portal functions take a scope instead of a staff Actor.
 */
export type PortalScope = {
  readonly email: string;
  readonly contacts: readonly ScopeContact[];
  /** The customers of the contacts. */
  readonly ownCustomerIds: readonly string[];
  /** Customers managed by an own customer (complexes seen through their agency). */
  readonly managedCustomerIds: readonly string[];
  /** Own plus managed: every customer whose quotes and properties may be shown. Sorted. */
  readonly customerIds: readonly string[];
  readonly [SCOPE_BRAND]: true;
};

/**
 * Builds the visible set from the contacts with access and the customers that name one of their customers
 * as manager. One level only: an entry whose manager is not an own customer is ignored. Null when there
 * is no contact (the session is then not valid).
 */
export function buildScope(
  email: string,
  contacts: readonly ScopeContact[],
  managed: readonly { id: string; managedById: string }[],
): PortalScope | null {
  if (contacts.length === 0) return null;
  const own = [...new Set(contacts.map((c) => c.customerId))].sort();
  const ownSet = new Set(own);
  const managedIds = [
    ...new Set(
      managed.filter((m) => ownSet.has(m.managedById) && !ownSet.has(m.id)).map((m) => m.id),
    ),
  ].sort();
  const scope = {
    email,
    contacts: [...contacts],
    ownCustomerIds: own,
    managedCustomerIds: managedIds,
    customerIds: [...own, ...managedIds].sort(),
  };
  return scope as unknown as PortalScope;
}

/** True while any of the person's contacts has not completed the welcome page. */
export function needsWelcome(scope: PortalScope): boolean {
  return scope.contacts.some((c) => !c.welcomed);
}

/**
 * Who is acting on a quote of `quoteCustomer`: the person's contact at that customer if there is one,
 * otherwise their contact at the customer's managing agency (recorded as done for the agency).
 */
export function pickActingContact(
  scope: PortalScope,
  quoteCustomer: { id: string; managedById: string | null },
): { contactId: string; customerId: string; forAgency: boolean } | null {
  const own = scope.contacts.find((c) => c.customerId === quoteCustomer.id);
  if (own) return { contactId: own.id, customerId: own.customerId, forAgency: false };
  if (!quoteCustomer.managedById) return null;
  const agency = scope.contacts.find((c) => c.customerId === quoteCustomer.managedById);
  return agency ? { contactId: agency.id, customerId: agency.customerId, forAgency: true } : null;
}

/**
 * The visible set for a signed-in email, from live data: contacts with that email and portal access whose
 * customer is neither archived nor anonymised, plus the customers those customers manage (also neither
 * archived nor anonymised). Reads only columns the `ace_portal` role is granted.
 */
export async function loadPortalScope(
  store: Pick<Db, "contact" | "customer">,
  email: string,
): Promise<PortalScope | null> {
  const contacts = await store.contact.findMany({
    where: {
      email,
      portalAccess: true,
      customer: { status: { not: "ARCHIVED" }, anonymisedAt: null },
    },
    orderBy: { id: "asc" },
    select: { id: true, customerId: true, name: true, portalWelcomedAt: true },
  });
  if (contacts.length === 0) return null;
  const own = [...new Set(contacts.map((c) => c.customerId))];
  const managed = await store.customer.findMany({
    where: { managedById: { in: own }, status: { not: "ARCHIVED" }, anonymisedAt: null },
    orderBy: { id: "asc" },
    select: { id: true, managedById: true },
  });
  return buildScope(
    email,
    contacts.map((c) => ({
      id: c.id,
      customerId: c.customerId,
      name: c.name,
      welcomed: c.portalWelcomedAt !== null,
    })),
    managed.flatMap((m) => (m.managedById ? [{ id: m.id, managedById: m.managedById }] : [])),
  );
}
