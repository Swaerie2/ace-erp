import { assertRole, DomainError, MANAGEMENT, type Actor } from "../customers/access";
import {
  findEditableCustomer,
  lockCustomer,
  logCustomerEvent,
  type Store,
} from "../customers/store";
import type { CustomerStatus } from "../generated/prisma/enums";

/** Every refusal of the managing-agency rules. The staff app maps them to fixed codes in the address bar. */
export const HIERARCHY_MESSAGES = {
  self: "A customer cannot manage itself.",
  agencyMissing: "That agency could not be found.",
  agencyAnonymised: "An anonymised customer cannot be linked.",
  agencyArchived: "Restore that agency before linking complexes to it.",
  agencyIsManaged: "That customer is itself managed by an agency. Only one level is allowed.",
  complexManagesOthers:
    "This customer manages complexes itself, so it cannot be managed by an agency.",
  notManaged: "Link this customer to a managing agency first.",
  agencyStillManages:
    "This customer still manages complexes. Move its complexes to another agency, or remove their link, before anonymising it.",
} as const;
export type HierarchyMessageKey = keyof typeof HIERARCHY_MESSAGES;

async function readAgency(store: Store, agencyId: string) {
  const agency = await store.customer.findUnique({
    where: { id: agencyId },
    select: { id: true, status: true, anonymisedAt: true, managedById: true },
  });
  if (!agency) throw new DomainError(HIERARCHY_MESSAGES.agencyMissing);
  if (agency.anonymisedAt) throw new DomainError(HIERARCHY_MESSAGES.agencyAnonymised);
  if (agency.status === "ARCHIVED") throw new DomainError(HIERARCHY_MESSAGES.agencyArchived);
  if (agency.managedById) throw new DomainError(HIERARCHY_MESSAGES.agencyIsManaged);
  return agency;
}

async function assertManagesNobody(store: Store, customerId: string) {
  if ((await store.customer.count({ where: { managedById: customerId } })) > 0) {
    throw new DomainError(HIERARCHY_MESSAGES.complexManagesOthers);
  }
}

/**
 * Links a complex to its managing agency (or moves it to another one). One level only: the agency must
 * not itself be managed, and the complex must not manage anyone. Lock order: both customers, smaller id
 * first, then every rule is checked again on fresh reads.
 */
export async function setManagedBy(
  store: Store,
  actor: Actor,
  complexId: string,
  agencyId: string,
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  if (complexId === agencyId) throw new DomainError(HIERARCHY_MESSAGES.self);
  const check = async () => {
    const complex = await findEditableCustomer(store, complexId);
    await readAgency(store, agencyId);
    await assertManagesNobody(store, complexId);
    return complex;
  };
  if ((await check()).managedById === agencyId) return;
  for (const id of [complexId, agencyId].sort()) await lockCustomer(store, id);
  const complex = await check();
  if (complex.managedById === agencyId) return;
  const previous = complex.managedById;
  await store.customer.update({
    where: { id: complexId },
    data: { managedById: agencyId },
    select: { id: true },
  });
  await logCustomerEvent(store, actor, "customer.manager_set", complexId, {
    managerId: agencyId,
    previousManagerId: previous,
  });
  await logCustomerEvent(store, actor, "customer.complex_added", agencyId, { complexId });
  if (previous) {
    await logCustomerEvent(store, actor, "customer.complex_removed", previous, { complexId });
  }
}

/** Removes the complex's managing agency. "Bills go to" returns to its default. */
export async function clearManagedBy(store: Store, actor: Actor, complexId: string): Promise<void> {
  assertRole(actor, MANAGEMENT);
  if (!(await findEditableCustomer(store, complexId)).managedById) return;
  await lockCustomer(store, complexId);
  const complex = await findEditableCustomer(store, complexId);
  const previous = complex.managedById;
  if (!previous) return;
  await store.customer.update({
    where: { id: complexId },
    data: { managedById: null, billsToManager: true },
    select: { id: true },
  });
  await logCustomerEvent(store, actor, "customer.manager_cleared", complexId, {
    previousManagerId: previous,
  });
  await logCustomerEvent(store, actor, "customer.complex_removed", previous, { complexId });
}

/** While a complex is managed: bills go to the agency (true) or to the complex itself (false). */
export async function setBillsToManager(
  store: Store,
  actor: Actor,
  complexId: string,
  billsToManager: boolean,
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  const check = async () => {
    const complex = await findEditableCustomer(store, complexId);
    if (!complex.managedById) throw new DomainError(HIERARCHY_MESSAGES.notManaged);
    return complex;
  };
  if ((await check()).billsToManager === billsToManager) return;
  await lockCustomer(store, complexId);
  if ((await check()).billsToManager === billsToManager) return;
  await store.customer.update({
    where: { id: complexId },
    data: { billsToManager },
    select: { id: true },
  });
  await logCustomerEvent(store, actor, "customer.bills_to_changed", complexId, { billsToManager });
}

export type CustomerHierarchy = {
  manager: { id: string; number: number; displayName: string } | null;
  billsToManager: boolean;
  complexes: {
    id: string;
    number: number;
    displayName: string;
    status: CustomerStatus;
    propertyCount: number;
    quoteCount: number;
  }[];
};

/** The customer's managing agency (if any), its billing switch, and the complexes it manages. */
export async function getCustomerHierarchy(
  store: Store,
  actor: Actor,
  customerId: string,
): Promise<CustomerHierarchy> {
  assertRole(actor, MANAGEMENT);
  const row = await store.customer.findUnique({
    where: { id: customerId },
    select: {
      billsToManager: true,
      managedBy: { select: { id: true, number: true, displayName: true } },
      managedCustomers: {
        orderBy: { displayName: "asc" },
        select: {
          id: true,
          number: true,
          displayName: true,
          status: true,
          _count: { select: { properties: { where: { archivedAt: null } }, quotes: true } },
        },
      },
    },
  });
  if (!row) throw new DomainError("That customer could not be found.");
  return {
    manager: row.managedBy,
    billsToManager: row.billsToManager,
    complexes: row.managedCustomers.map((c) => ({
      id: c.id,
      number: c.number,
      displayName: c.displayName,
      status: c.status,
      propertyCount: c._count.properties,
      quoteCount: c._count.quotes,
    })),
  };
}

export type AgencyOption = { id: string; number: number; displayName: string };

/** Customers that could become this customer's managing agency, by name. At least two characters. */
export async function searchAgencies(
  store: Store,
  actor: Actor,
  query: { q: string; excludeId: string },
): Promise<AgencyOption[]> {
  assertRole(actor, MANAGEMENT);
  const term = query.q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const contains = { contains: term, mode: "insensitive" } as const;
  return store.customer.findMany({
    where: {
      id: { not: query.excludeId },
      managedById: null,
      anonymisedAt: null,
      status: { not: "ARCHIVED" },
      OR: [{ displayName: contains }, { companyName: contains }],
    },
    orderBy: { displayName: "asc" },
    take: 10,
    select: { id: true, number: true, displayName: true },
  });
}
