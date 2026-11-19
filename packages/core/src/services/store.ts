import { recordAudit } from "../audit";
import type { Actor } from "../customers/access";
import type { Db } from "../db";
import type { Prisma } from "../generated/prisma/client";

/** What the service functions need. Works with the normal connection or a transaction. */
export type ServiceStore = Pick<Db, "service" | "auditLog">;

/** Writes an audit line about a service. `after` holds field names and fixed words, never typed text. */
export async function logServiceEvent(
  store: ServiceStore,
  actor: Actor,
  action: string,
  serviceId: string,
  after?: Prisma.InputJsonValue,
): Promise<void> {
  await recordAudit(store, {
    actorType: "STAFF",
    actorId: actor.id,
    action,
    entityType: "service",
    entityId: serviceId,
    ...(after !== undefined ? { after } : {}),
    ...(actor.ip ? { ip: actor.ip } : {}),
    ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
  });
}
