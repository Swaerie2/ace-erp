import { z } from "zod";
import { assertRole, MANAGEMENT, type Actor } from "../customers/access";
import type { Prisma } from "../generated/prisma/client";
import type { InvoiceStore } from "./store";

export type InvoiceActivityEntry = {
  id: string;
  at: Date;
  action: string;
  actorType: string;
  actorId: string | null;
  after: Prisma.JsonValue;
  actorName: string;
};

/** The invoice's history for the staff screen, newest first, with staff names. */
export async function listInvoiceActivity(
  store: InvoiceStore,
  actor: Actor,
  id: string,
  limit = 100,
): Promise<InvoiceActivityEntry[]> {
  assertRole(actor, MANAGEMENT);
  // Ids are compared as text in the audit table, but a bad one is still nobody's history.
  if (!z.uuid().safeParse(id).success) return [];
  const take = Math.min(500, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 100));
  const entries = await store.auditLog.findMany({
    where: { entityType: "invoice", entityId: id },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take,
    select: { id: true, at: true, action: true, actorType: true, actorId: true, after: true },
  });
  const ids = [
    ...new Set(
      entries
        .filter((e) => e.actorType === "STAFF")
        .map((e) => e.actorId)
        .filter((v): v is string => Boolean(v) && z.uuid().safeParse(v).success),
    ),
  ];
  const staff =
    ids.length === 0
      ? []
      : await store.staffUser.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        });
  const names = new Map(staff.map((s) => [s.id, s.name]));
  return entries.map((e) => ({
    ...e,
    actorName:
      e.actorType === "CUSTOMER"
        ? "Client (portal)"
        : e.actorId
          ? (names.get(e.actorId) ?? "Staff")
          : "System",
  }));
}

/** Plain words for the history list. Unknown actions show as they are stored. */
export const INVOICE_ACTION_LABELS: Record<string, string> = {
  "invoice.drafted": "Draft created",
  "invoice.deleted_draft": "Draft deleted",
  "invoice.issued": "Issued",
  "invoice.voided": "Voided",
  "invoice.emailed": "Emailed",
  "invoice.email_failed": "Email not sent",
  "invoice.payment_allocated": "Payment allocated",
  "invoice.payment_unallocated": "Payment allocation removed",
  "invoice.report_confirmed": "Reported payment confirmed",
  "invoice.report_dismissed": "Reported payment dismissed",
};
