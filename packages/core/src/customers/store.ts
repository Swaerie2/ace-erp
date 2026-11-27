import { recordAudit, staffParty, type AuditParty } from "../audit";
import { getDb, type Db } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { DomainError, type Actor } from "./access";

/** What the customer functions need. Works with the normal connection or a transaction. */
export type Store = Pick<
  Db,
  | "customer"
  | "contact"
  | "property"
  | "auditLog"
  | "staffUser"
  | "quote"
  | "portalCode"
  | "portalSession"
>;

/** Runs several writes as one all-or-nothing step. */
export function inTx<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  return getDb().$transaction((tx) => fn(tx), {
    timeout: opts.timeoutMs ?? 15_000,
    maxWait: 10_000,
  });
}

/** Writes an audit line about a customer for any acting party. `after` holds field NAMES and ids only. */
export async function logCustomerEventAs(
  store: Pick<Db, "auditLog">,
  party: AuditParty,
  action: string,
  customerId: string,
  after?: Prisma.InputJsonValue,
): Promise<void> {
  await recordAudit(store, {
    actorType: party.actorType,
    ...(party.actorId ? { actorId: party.actorId } : {}),
    action,
    entityType: "customer",
    entityId: customerId,
    ...(after !== undefined ? { after } : {}),
    ...(party.ip ? { ip: party.ip } : {}),
    ...(party.userAgent ? { userAgent: party.userAgent } : {}),
  });
}

/** Writes an audit line about a customer. `after` must hold field NAMES and ids, never personal values. */
export async function logCustomerEvent(
  store: Pick<Db, "auditLog">,
  actor: Actor,
  action: string,
  customerId: string,
  after?: Prisma.InputJsonValue,
): Promise<void> {
  await logCustomerEventAs(store, staffParty(actor), action, customerId, after);
}

/** Names of the fields whose value differs. Used for audit lines (names only, never values). */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const norm = (v: unknown) => (v === undefined ? null : v);
  return Object.keys(after).filter((key) => !Object.is(norm(before[key]), norm(after[key])));
}

/**
 * Reads a customer and throws a friendly error if it is missing or anonymised. Takes no lock, so
 * it is safe for deciding "is there anything to do?" without touching the row. Anything that then
 * writes must call `lockCustomer` (or use `requireEditableCustomer`, which does both).
 */
export async function findEditableCustomer(store: Pick<Db, "customer">, customerId: string) {
  const customer = await store.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new DomainError("That customer could not be found.");
  if (customer.anonymisedAt) {
    throw new DomainError("This customer has been anonymised and cannot be changed.");
  }
  return customer;
}

/**
 * Like `findEditableCustomer` but reads only id, status and anonymisedAt, so it works for the client
 * portal's column-limited database role. Takes no lock.
 */
export async function findEditableCustomerNarrow(store: Pick<Db, "customer">, customerId: string) {
  const customer = await store.customer.findUnique({
    where: { id: customerId },
    select: { id: true, status: true, anonymisedAt: true },
  });
  if (!customer) throw new DomainError("That customer could not be found.");
  if (customer.anonymisedAt) {
    throw new DomainError("This customer has been anonymised and cannot be changed.");
  }
  return customer;
}

/**
 * Locks the customer row until the transaction ends, by touching it. This serialises an edit
 * against a concurrent anonymise under READ COMMITTED: whichever comes second waits for the first
 * to commit. The update is conditional on the customer not being anonymised, and Postgres
 * re-checks that condition after waiting, so an edit that lost the race is refused instead of
 * writing personal data back into an anonymised customer.
 * It does bump `updatedAt`, so call it only when something is really about to be written.
 */
export async function lockCustomer(store: Pick<Db, "customer">, customerId: string): Promise<void> {
  const { count } = await store.customer.updateMany({
    where: { id: customerId, anonymisedAt: null },
    data: { updatedAt: new Date() },
  });
  if (count === 1) return;
  const exists = await store.customer.findUnique({
    where: { id: customerId },
    select: { id: true },
  });
  if (!exists) throw new DomainError("That customer could not be found.");
  throw new DomainError("This customer has been anonymised and cannot be changed.");
}

/** Throws a friendly error if the customer is missing or anonymised, then locks the row. */
export async function requireEditableCustomer(store: Pick<Db, "customer">, customerId: string) {
  const customer = await findEditableCustomer(store, customerId);
  await lockCustomer(store, customerId);
  return customer;
}
