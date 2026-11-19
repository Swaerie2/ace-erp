import type { listCustomerActivity } from "@ace/core";
import { formatDateTime } from "@/lib/format";

type Entries = Awaited<ReturnType<typeof listCustomerActivity>>;

const label: Record<string, string> = {
  "customer.created": "Customer created",
  "customer.updated": "Details changed",
  "customer.archived": "Archived",
  "customer.restored": "Restored",
  "customer.contact_added": "Contact added",
  "customer.contact_updated": "Contact changed",
  "customer.contact_removed": "Contact removed",
  "customer.property_added": "Property added",
  "customer.property_updated": "Property changed",
  "customer.property_archived": "Property archived",
  "customer.exported": "Data exported",
  "customer.anonymised": "Anonymised",
};

/** Field names only. The audit entry's other contents are never shown. */
function changedFields(after: unknown): string[] {
  const changed = (after as { changed?: unknown } | null)?.changed;
  return Array.isArray(changed) ? changed.filter((f): f is string => typeof f === "string") : [];
}

export function ActivityTab({ entries }: { entries: Entries }) {
  if (entries.length === 0) return <p className="text-charcoal/60">No activity yet.</p>;
  return (
    <ul className="divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
      {entries.map((e) => {
        const fields = changedFields(e.after);
        return (
          <li key={e.id} className="px-4 py-3 text-sm">
            <p className="font-semibold text-forest">{label[e.action] ?? e.action}</p>
            <p className="text-charcoal/60">
              {e.actorName} · {formatDateTime(e.at)}
              {fields.length ? ` · fields: ${fields.join(", ")}` : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
