import { assertRole, MANAGEMENT, type Actor } from "../customers/access";
import type { QuoteStore } from "./store";

export async function listQuoteActivity(store: QuoteStore, actor: Actor, id: string, limit = 100) {
  assertRole(actor, MANAGEMENT);
  const entries = await store.auditLog.findMany({
    where: { entityType: "quote", entityId: id },
    orderBy: { at: "desc" },
    take: limit,
    select: { id: true, at: true, action: true, actorType: true, actorId: true, after: true },
  });
  // Only staff ids are looked up; a client acceptance carries the customer id, which is not staff.
  const ids = [
    ...new Set(
      entries
        .filter((e) => e.actorType === "STAFF")
        .map((e) => e.actorId)
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const staff = await store.staffUser.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const names = new Map(staff.map((s) => [s.id, s.name]));
  return entries.map((e) => ({
    ...e,
    actorName:
      e.actorType === "CUSTOMER"
        ? "Client (private link)"
        : e.actorId
          ? (names.get(e.actorId) ?? "Staff")
          : "System",
  }));
}
