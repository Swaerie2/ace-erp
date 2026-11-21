import type { AuditActorType, Prisma } from "./generated/prisma/client";
import type { Db } from "./db";

export type AuditEntry = {
  actorType: AuditActorType;
  /** Staff or customer id. Leave empty for SYSTEM actions. */
  actorId?: string;
  /** Short verb phrase, e.g. "quote.sent", "customer.updated", "staff.signed_in". */
  action: string;
  entityType?: string;
  entityId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string;
  userAgent?: string;
};

/**
 * Writes one line to the audit log. The log is append-only: it is only ever added to.
 * Never put passwords, one-time codes, tokens or full bank details in before/after.
 */
export async function recordAudit(db: Pick<Db, "auditLog">, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      ...(entry.before !== undefined ? { before: entry.before } : {}),
      ...(entry.after !== undefined ? { after: entry.after } : {}),
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    },
    select: { id: true },
  });
}

/** Who did something, for the audit log. */
export type AuditParty = {
  actorType: AuditActorType;
  actorId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export function staffParty(actor: {
  id: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}): AuditParty {
  return {
    actorType: "STAFF",
    actorId: actor.id,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  };
}

/**
 * A client acting through the private link. Deliberately carries NO address and NO browser string: the
 * audit log is append-only and is never scrubbed, so a visitor's details must not be written to it.
 * (They are kept on the acceptance record itself, which is scrubbed when the customer is anonymised.)
 */
export function clientParty(customerId: string): AuditParty {
  return { actorType: "CUSTOMER", actorId: customerId };
}
