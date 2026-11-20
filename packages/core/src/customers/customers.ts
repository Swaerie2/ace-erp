import type { Db } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { CustomerStatus } from "../generated/prisma/enums";
import { assertRole, DomainError, MANAGEMENT, type Actor } from "./access";
import { contactData, customerData, propertyData } from "./mappers";
import { parseCustomerNumber } from "./number";
import type { ContactInput, CustomerInput, PropertyInput } from "./schemas";
import {
  changedFields,
  findEditableCustomer,
  lockCustomer,
  logCustomerEvent,
  type Store,
} from "./store";
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
  const plan = (existing: Awaited<ReturnType<typeof findEditableCustomer>>) => {
    const data = {
      ...customerData(input),
      // An archived customer stays archived; restoring is a separate action.
      status: existing.status === "ARCHIVED" ? ("ARCHIVED" as const) : input.status,
      // The consent date is kept while the box stays ticked, so an unchanged save compares equal.
      consentAt: input.consentGiven ? (existing.consentAt ?? new Date()) : null,
    };
    return { data, changed: changedFields(existing, data) };
  };

  // Look first WITHOUT locking: a save that changes nothing must write nothing, not even the
  // lock (which touches updatedAt) or an audit line.
  if (plan(await findEditableCustomer(store, id)).changed.length === 0) return;

  // Something changed: lock the customer for the rest of the transaction, then read it again,
  // because a concurrent edit may have landed between the first read and the lock.
  await lockCustomer(store, id);
  const { data, changed } = plan(await findEditableCustomer(store, id));
  if (changed.length === 0) return;
  await store.customer.update({ where: { id }, data });
  await logCustomerEvent(store, actor, "customer.updated", id, { changed });
}

export async function archiveCustomer(store: Store, actor: Actor, id: string): Promise<void> {
  assertRole(actor, MANAGEMENT);
  // Look first WITHOUT locking, so an already-archived customer is left completely untouched.
  if ((await findEditableCustomer(store, id)).status === "ARCHIVED") return;
  // Then lock and decide again from a fresh read: a concurrent change may have landed in between.
  await lockCustomer(store, id);
  const existing = await findEditableCustomer(store, id);
  if (existing.status === "ARCHIVED") return;
  await store.customer.update({
    where: { id },
    data: { status: "ARCHIVED", statusBeforeArchive: existing.status, archivedAt: new Date() },
  });
  await logCustomerEvent(store, actor, "customer.archived", id);
}

export async function restoreCustomer(store: Store, actor: Actor, id: string): Promise<void> {
  assertRole(actor, MANAGEMENT);
  // Look first WITHOUT locking, so a customer that is not archived is left completely untouched.
  if ((await findEditableCustomer(store, id)).status !== "ARCHIVED") return;
  // Then lock and decide again from a fresh read: a concurrent change may have landed in between.
  await lockCustomer(store, id);
  const existing = await findEditableCustomer(store, id);
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

/**
 * Turns a lead (or a paused customer) into an active customer in one step. An active customer is
 * left completely untouched. An archived customer is refused: restore it first, so a former client
 * cannot be switched on by accident. Module 3 will call this when a client accepts a quote.
 */
export async function activateCustomer(
  store: Pick<Db, "customer" | "auditLog">,
  actor: Actor,
  id: string,
  opts: { via?: "quote" } = {},
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  /** True when there is something to do; throws for an archived customer. */
  const needsActivating = (status: CustomerStatus) => {
    if (status === "ARCHIVED") {
      throw new DomainError("Restore this customer before marking it as active.");
    }
    return status === "LEAD" || status === "PAUSED";
  };
  // Look first WITHOUT locking, so an already active customer is left completely untouched.
  if (!needsActivating((await findEditableCustomer(store, id)).status)) return;
  // Then lock and decide again from a fresh read: a concurrent change may have landed in between.
  await lockCustomer(store, id);
  const existing = await findEditableCustomer(store, id);
  if (!needsActivating(existing.status)) return;
  await store.customer.update({ where: { id }, data: { status: "ACTIVE" } });
  // Only the previous status is recorded (it is not personal data).
  await logCustomerEvent(store, actor, "customer.activated", id, {
    from: existing.status,
    ...(opts.via ? { via: opts.via } : {}),
  });
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

const STATUSES: readonly string[] = Object.values(CustomerStatus);

function isStatusFilter(value: unknown): value is CustomerStatus | "ALL" {
  return typeof value === "string" && (value === "ALL" || STATUSES.includes(value));
}

function buildWhere(query: ListQuery): Prisma.CustomerWhereInput {
  const and: Prisma.CustomerWhereInput[] = [];
  // The status comes from a URL, so check it at runtime: anything unknown means "no filter".
  const status = isStatusFilter(query.status) ? query.status : undefined;
  if (status === "ALL") {
    // show everything
  } else if (status) {
    and.push({ status });
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
  // Archived properties are hidden everywhere else, so they must not be counted either.
  _count: { select: { properties: { where: { archivedAt: null } } } },
} as const satisfies Prisma.CustomerSelect;

/** Whole number within [min, max]. NaN, Infinity and non-numbers fall back to `fallback`. */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const whole = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, whole));
}

function paging(query: { page?: number | undefined; pageSize?: number | undefined }) {
  const pageSize = clampInt(query.pageSize, 1, 100, 25);
  const page = clampInt(query.page, 1, 10_000, 1);
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

/** Staff roles that may use the crew-safe views. */
const CREW_READERS = ["OWNER", "MANAGER", "CREW"] as const;

const CREW_VISIBLE: Prisma.CustomerWhereInput = { status: { in: ["ACTIVE", "PAUSED"] } };

export async function listCustomersForCrew(
  store: Store,
  actor: Actor,
  query: { q?: string | undefined; page?: number | undefined },
) {
  assertRole(actor, CREW_READERS);
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
                      archivedAt: null,
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

export async function getCustomerForCrew(store: Store, actor: Actor, id: string) {
  assertRole(actor, CREW_READERS);
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
