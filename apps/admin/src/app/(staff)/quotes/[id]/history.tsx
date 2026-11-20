import { SENT_METHOD_LABELS, type listQuoteActivity } from "@ace/core";
import { formatDateTime } from "@/lib/format";

type Entries = Awaited<ReturnType<typeof listQuoteActivity>>;

const LABELS: Record<string, string> = {
  "quote.created": "Draft started",
  "quote.issued": "Issued",
  "quote.revised": "Revision started",
  "quote.sent": "Marked as sent",
  "quote.accepted": "Accepted",
  "quote.declined": "Declined",
  "quote.withdrawn": "Withdrawn",
  "quote.reversed": "Acceptance reversed",
  "quote.replaced": "Replaced by a newer version",
  "quote.agreement_ended": "Agreement replaced by a newer quote",
};

/** Only fixed words from the audit entry are shown, never anything typed by a person. */
function detail(action: string, after: unknown): string {
  const method = (after as { method?: unknown } | null)?.method;
  if (action === "quote.sent" && typeof method === "string" && method in SENT_METHOD_LABELS) {
    return ` · ${SENT_METHOD_LABELS[method as keyof typeof SENT_METHOD_LABELS]}`;
  }
  return "";
}

export function QuoteHistory({ entries }: { entries: Entries }) {
  if (entries.length === 0) return <p className="text-charcoal/60">No history yet.</p>;
  return (
    <ul className="divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
      {entries.map((e) => (
        <li key={e.id} className="px-4 py-3 text-sm">
          <p className="font-semibold text-forest">
            {LABELS[e.action] ?? e.action}
            {detail(e.action, e.after)}
          </p>
          <p className="text-charcoal/60">
            {e.actorName} · {formatDateTime(e.at)}
          </p>
        </li>
      ))}
    </ul>
  );
}
