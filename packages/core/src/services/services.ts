import { assertRole, DomainError, MANAGEMENT, type Actor } from "../customers/access";
import { changedFields } from "../customers/store";
import type { Prisma } from "../generated/prisma/client";
import type { ServiceInput } from "./schemas";
import { logServiceEvent, type ServiceStore } from "./store";

const NOT_FOUND = "That service could not be found.";
const DUPLICATE = "A service with that name already exists.";

/** Display order: by number, ties broken by when the service was added. */
const ORDER: Prisma.ServiceOrderByWithRelationInput[] = [
  { sortOrder: "asc" },
  { createdAt: "asc" },
];

export async function listServices(
  store: ServiceStore,
  actor: Actor,
  opts: { includeArchived?: boolean } = {},
) {
  assertRole(actor, MANAGEMENT);
  return store.service.findMany({
    where: opts.includeArchived ? {} : { archivedAt: null },
    orderBy: ORDER,
  });
}

export async function getService(store: ServiceStore, actor: Actor, id: string) {
  assertRole(actor, MANAGEMENT);
  return store.service.findUnique({ where: { id } });
}

async function findService(store: ServiceStore, id: string) {
  const service = await store.service.findUnique({ where: { id } });
  if (!service) throw new DomainError(NOT_FOUND);
  return service;
}

/**
 * Locks one service row until the transaction ends, by touching it, so two people changing the
 * same service take turns. Call it only when something is really about to be written.
 */
async function lockService(store: ServiceStore, id: string): Promise<void> {
  const { count } = await store.service.updateMany({
    where: { id },
    data: { updatedAt: new Date() },
  });
  if (count !== 1) throw new DomainError(NOT_FOUND);
}

/** Same idea for reordering, which changes several rows at once. */
async function lockSwitchedOnServices(store: ServiceStore): Promise<void> {
  await store.service.updateMany({ where: { archivedAt: null }, data: { updatedAt: new Date() } });
}

/** True when the database refused a write because the name is already taken. */
function isNameClash(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === "P2002" || (typeof message === "string" && message.includes("services_name_lower_key"))
  );
}

async function assertNameFree(store: ServiceStore, name: string, exceptId?: string): Promise<void> {
  const clash = await store.service.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new DomainError(DUPLICATE);
}

export async function createService(store: ServiceStore, actor: Actor, input: ServiceInput) {
  assertRole(actor, MANAGEMENT);
  await assertNameFree(store, input.name);
  const last = await store.service.findFirst({
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  let created: { id: string };
  try {
    created = await store.service.create({
      data: { ...input, sortOrder: (last?.sortOrder ?? 0) + 1 },
      select: { id: true },
    });
  } catch (error) {
    // Two people adding the same name at the same moment: the database index catches the loser.
    if (isNameClash(error)) throw new DomainError(DUPLICATE);
    throw error;
  }
  await logServiceEvent(store, actor, "service.created", created.id, { kind: input.kind });
  return created;
}

export async function updateService(
  store: ServiceStore,
  actor: Actor,
  id: string,
  input: ServiceInput,
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  // Look first WITHOUT locking: a save that changes nothing must write nothing.
  if (changedFields(await findService(store, id), input).length === 0) return;
  // Something changed: lock, then read again, because a concurrent edit may have landed between.
  await lockService(store, id);
  const existing = await findService(store, id);
  const changed = changedFields(existing, input);
  if (changed.length === 0) return;
  if (changed.includes("name")) await assertNameFree(store, input.name, id);
  try {
    await store.service.update({ where: { id }, data: input });
  } catch (error) {
    if (isNameClash(error)) throw new DomainError(DUPLICATE);
    throw error;
  }
  await logServiceEvent(store, actor, "service.updated", id, { changed });
}

export async function archiveService(store: ServiceStore, actor: Actor, id: string): Promise<void> {
  assertRole(actor, MANAGEMENT);
  if ((await findService(store, id)).archivedAt) return;
  await lockService(store, id);
  if ((await findService(store, id)).archivedAt) return;
  await store.service.update({ where: { id }, data: { archivedAt: new Date() } });
  await logServiceEvent(store, actor, "service.archived", id);
}

/** Switching a service back on puts it at the end of the list. */
export async function restoreService(store: ServiceStore, actor: Actor, id: string): Promise<void> {
  assertRole(actor, MANAGEMENT);
  if (!(await findService(store, id)).archivedAt) return;
  await lockService(store, id);
  if (!(await findService(store, id)).archivedAt) return;
  const last = await store.service.findFirst({
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  await store.service.update({
    where: { id },
    data: { archivedAt: null, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  await logServiceEvent(store, actor, "service.restored", id);
}

/**
 * Swaps a switched-on service with its neighbour (up or down) and renumbers the switched-on
 * services 1, 2, 3... At the top or bottom there is nothing to do and nothing is written.
 */
export async function moveService(
  store: ServiceStore,
  actor: Actor,
  id: string,
  direction: "up" | "down",
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  const switchedOn = () =>
    store.service.findMany({
      where: { archivedAt: null },
      orderBy: ORDER,
      select: { id: true, sortOrder: true },
    });
  /** The new order of ids, or null when the service is already at that end. */
  const plan = (list: { id: string }[]): string[] | null => {
    const from = list.findIndex((s) => s.id === id);
    if (from === -1) throw new DomainError("Only a switched-on service can be moved.");
    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= list.length) return null;
    const ids = list.map((s) => s.id);
    const moved = ids[from];
    const other = ids[to];
    if (moved === undefined || other === undefined) return null;
    ids[from] = other;
    ids[to] = moved;
    return ids;
  };

  // Look first WITHOUT locking, so a move that cannot happen leaves everything untouched.
  if (plan(await switchedOn()) === null) return;
  await lockSwitchedOnServices(store);
  const list = await switchedOn();
  const order = plan(list);
  if (order === null) return;
  const current = new Map(list.map((s) => [s.id, s.sortOrder]));
  for (const [index, serviceId] of order.entries()) {
    if (current.get(serviceId) === index + 1) continue;
    await store.service.update({ where: { id: serviceId }, data: { sortOrder: index + 1 } });
  }
  await logServiceEvent(store, actor, "service.moved", id, { direction });
}
