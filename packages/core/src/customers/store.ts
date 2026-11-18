import { recordAudit } from "../audit";
import { getDb, type Db } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { DomainError, type Actor } from "./access";

/** What the customer functions need. Works with the normal connection or a transaction. */
export type Store = Pick<Db, "customer" | "contact" | "property" | "auditLog" | "staffUser">;

/** Runs several writes as one all-or-nothing step. */
export function inTx<T>(
  fn: (tx: Store) => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  return getDb().$transaction((tx) => fn(tx), {
    timeout: opts.timeoutMs ?? 15_000,
    maxWait: 10_000,
  });
}

/** Writes an audit line about a customer. `after` must hold field NAMES and ids, never personal values. */
export async function logCustomerEvent(
  store: Store,
  actor: Actor,
  action: string,
  customerId: string,
  after?: Prisma.InputJsonValue,
): Promise<void> {
  await recordAudit(store, {
    actorType: "STAFF",
    actorId: actor.id,
    action,
    entityType: "customer",
    entityId: customerId,
    ...(after !== undefined ? { after } : {}),
    ...(actor.ip ? { ip: actor.ip } : {}),
    ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
  });
}

/** Names of the fields whose value differs. Used for audit lines (names only, never values). */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const norm = (v: unknown) => (v === undefined ? null : v);
  return Object.keys(after).filter((key) => !Object.is(norm(before[key]), norm(after[key])));
}

/** Throws a friendly error if the customer is missing or anonymised. */
export async function requireEditableCustomer(store: Store, customerId: string) {
  const customer = await store.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new DomainError("That customer could not be found.");
  if (customer.anonymisedAt) {
    throw new DomainError("This customer has been anonymised and cannot be changed.");
  }
  return customer;
}
