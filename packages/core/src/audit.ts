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
  });
}
