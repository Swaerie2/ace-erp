import type { CustomerStatus, Prisma } from "../generated/prisma/client";
import { assertRole, MANAGEMENT, type Actor } from "./access";
import { contactData, customerData, propertyData } from "./mappers";
import { parseCustomerNumber } from "./number";
import type { ContactInput, CustomerInput, PropertyInput } from "./schemas";
import { changedFields, logCustomerEvent, requireEditableCustomer, type Store } from "./store";
import { CREW_CUSTOMER_SELECT } from "./views";

export type NewCustomerInput = {
  customer: CustomerInput;
  contact: ContactInput;
  property?: PropertyInput | undefined;
};

export async function createCustomer(store: Store, actor: Actor, input: NewCustomerInput) {
  assertRole(actor, MANAGEMENT);
  const { customer, contact, property } = input;
  const created = await store.customer.create({
    data: {
      ...customerData(customer),
      consentAt: customer.consentGiven ? new Date() : null,
      createdById: actor.id,
      contacts: { create: [contactData(contact)] },
      ...(property ? { properties: { create: [propertyData(property)] } } : {}),
    },
    select: { id: true, number: true },
  });
  await logCustomerEvent(store, actor, "customer.created", created.id, {
    number: created.number,
    type: customer.type,
    status: customer.status,
  });
  return created;
}

export async function updateCustomer(
  store: Store,
  actor: Actor,
  id: string,
  input: CustomerInput,
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  const existing = await requireEditableCustomer(store, id);
  const data = {
    ...customerData(input),
    // An archived customer stays archived; restoring is a separate action.
    status: existing.status === "ARCHIVED" ? ("ARCHIVED" as const) : input.status,
  };
  const consentAt = input.consentGiven ? (existing.consentAt ?? new Date()) : null;
  const changed = changedFields(existing, { ...data, consentAt });
  await store.customer.update({ where: { id }, data: { ...data, consentAt } });
  await logCustomerEvent(store, actor, "customer.updated", id, { changed });
}

export async function archiveCustomer(store: Store, actor: Actor, id: string): Promise<void> {
  assertRole(actor, MANAGEMENT);
  const existing = await requireEditableCustomer(store, id);
  if (existing.status === "ARCHIVED") return;
  await store.customer.update({
    where: { id },
    data: { status: "ARCHIVED", statusBeforeArchive: existing.status, archivedAt: new Date() },
  });
  await logCustomerEvent(store, actor, "customer.archived", id);
}

export async function restoreCustomer(store: Store, actor: Actor, id: string): Promise<void> {
  assertRole(actor, MANAGEMENT);
  const existing = await requireEditableCustomer(store, id);
  if (existing.status !== "ARCHIVED") return;
  await store.customer.update({
    where: { id },
    data: {
      status: existing.statusBeforeArchive ?? "ACTIVE",
      statusBeforeArchive: null,
      archivedAt: null,
    },
  });
  await logCustomerEvent(store, actor, "customer.restored", id);
}

// --- searching ----------------------------------------------------------------------------------

export type ListQuery = {
  q?: string | undefined;
  status?: CustomerStatus | "ALL" | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
};

/** "082 123", "0821234567" -> a fragment comparable with stored +27 numbers. */
function phoneSearchTerm(q: string): string | null {
  const digits = q.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.startsWith("0") ? `27${digits.slice(1)}` : digits;
}

function buildWhere(query: ListQuery): Prisma.CustomerWhereInput {
  const and: Prisma.CustomerWhereInput[] = [];
  if (query.status === "ALL") {
    // show everything
  } else if (query.status) {
    and.push({ status: query.status });
  } else {
    and.push({ status: { not: "ARCHIVED" } });
  }

  const term = query.q?.trim();
  if (term) {
    const contains = { contains: term, mode: "insensitive" } as const;
    const number = parseCustomerNumber(term);
    const phone = phoneSearchTerm(term);
    const or: Prisma.CustomerWhereInput[] = [
      { displayName: contains },
      { companyName: contains },
      {
        contacts: {
          some: { OR: [{ name: contains }, { email: { contains: term.toLowerCase() } }] },
        },
      },
      { properties: { some: { OR: [{ addressLine1: contains }, { suburb: contains }] } } },
    ];
    if (number !== null) or.push({ number });
    if (phone) or.push({ contacts: { some: { phone: { contains: phone } } } });
    and.push({ OR: or });
  }
  return { AND: and };
}

const LIST_SELECT = {
  id: true,
  number: true,
  displayName: true,
  type: true,
  status: true,
  contacts: {
    orderBy: { createdAt: "asc" },
    take: 1,
    select: { name: true, email: true, phone: true },
  },
  _count: { select: { properties: true } },
} as const satisfies Prisma.CustomerSelect;

function paging(query: { page?: number | undefined; pageSize?: number | undefined }) {
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
  const page = Math.max(1, Math.floor(query.page ?? 1));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export async function listCustomers(store: Store, actor: Actor, query: ListQuery) {
  assertRole(actor, MANAGEMENT);
  const { page, pageSize, skip } = paging(query);
  const where = buildWhere(query);
  const items = await store.customer.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip,
    take: pageSize,
    select: LIST_SELECT,
  });
  const total = await store.customer.count({ where });
  return { items, total, page, pageSize };
}

export async function getCustomer(store: Store, actor: Actor, id: string) {
  assertRole(actor, MANAGEMENT);
  return store.customer.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: { createdAt: "asc" } },
      properties: { where: { archivedAt: null }, orderBy: { createdAt: "asc" } },
    },
  });
}

// --- crew ---------------------------------------------------------------------------------------

const CREW_VISIBLE: Prisma.CustomerWhereInput = { status: { in: ["ACTIVE", "PAUSED"] } };

export async function listCustomersForCrew(
  store: Store,
  _actor: Actor,
  query: { q?: string | undefined; page?: number | undefined },
) {
  const { page, pageSize, skip } = paging(query);
  const term = query.q?.trim();
  const where: Prisma.CustomerWhereInput = {
    AND: [
      CREW_VISIBLE,
      ...(term
        ? [
            {
              OR: [
                { displayName: { contains: term, mode: "insensitive" as const } },
                {
                  properties: {
                    some: {
                      OR: [
                        { addressLine1: { contains: term, mode: "insensitive" as const } },
                        { suburb: { contains: term, mode: "insensitive" as const } },
                      ],
                    },
                  },
                },
              ],
            },
          ]
        : []),
    ],
  };
  const items = await store.customer.findMany({
    where,
    orderBy: { displayName: "asc" },
    skip,
    take: pageSize,
    select: CREW_CUSTOMER_SELECT,
  });
  const total = await store.customer.count({ where });
  return { items, total, page, pageSize };
}

export async function getCustomerForCrew(store: Store, _actor: Actor, id: string) {
  return store.customer.findFirst({
    where: { id, ...CREW_VISIBLE },
    select: CREW_CUSTOMER_SELECT,
  });
}

// --- activity -----------------------------------------------------------------------------------

export async function listCustomerActivity(store: Store, actor: Actor, id: string, limit = 100) {
  assertRole(actor, MANAGEMENT);
  const entries = await store.auditLog.findMany({
    where: { entityType: "customer", entityId: id },
    orderBy: { at: "desc" },
    take: limit,
    select: { id: true, at: true, action: true, actorId: true, after: true },
  });
  const ids = [...new Set(entries.map((e) => e.actorId).filter((v): v is string => Boolean(v)))];
  const staff = await store.staffUser.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const names = new Map(staff.map((s) => [s.id, s.name]));
  return entries.map((e) => ({
    ...e,
    actorName: e.actorId ? (names.get(e.actorId) ?? "Staff") : "System",
  }));
}

export type { CustomerStatus } from "../generated/prisma/client";
