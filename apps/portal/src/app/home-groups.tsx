import type { PortalCustomerGroup, PortalQuoteState, PortalQuoteSummary } from "@ace/core/portal";
import Link from "next/link";

const STATE_LABELS: Record<PortalQuoteState, string> = {
  OPEN: "Open",
  EXPIRED: "Expired",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
};
const STATE_STYLES: Record<PortalQuoteState, string> = {
  OPEN: "bg-forest text-cream",
  EXPIRED: "bg-charcoal/10 text-charcoal",
  ACCEPTED: "bg-forest/10 text-forest",
  DECLINED: "bg-red-50 text-red-800",
};
const CUSTOMER_STATUS: Record<string, string> = {
  LEAD: "New",
  ACTIVE: "Active",
  PAUSED: "Paused",
  ARCHIVED: "Archived",
};

export function QuoteList({ quotes }: { quotes: PortalQuoteSummary[] }) {
  if (quotes.length === 0) return <p className="text-sm text-charcoal/60">No quotes yet.</p>;
  return (
    <ul className="space-y-2">
      {quotes.map((q) => (
        <li key={q.id}>
          <Link
            href={`/quotes/${q.id}`}
            prefetch={false}
            className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg bg-cream/60 px-3 py-2 ring-1 ring-charcoal/10 hover:ring-forest/40"
          >
            <span className="font-semibold text-forest">{q.reference}</span>
            <span className="flex flex-wrap items-center gap-2 text-sm text-charcoal/70">
              {q.state === "OPEN" ? <span>Valid until {q.validUntil}</span> : null}
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATE_STYLES[q.state]}`}
              >
                {STATE_LABELS[q.state]}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function CustomerGroup({
  group,
  open,
  showStatus,
}: {
  group: PortalCustomerGroup;
  open: boolean;
  showStatus: boolean;
}) {
  return (
    <details
      open={open}
      className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-charcoal/10 sm:p-5"
    >
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 font-display text-lg font-semibold text-forest">
        <span className="min-w-0 break-words">{group.name}</span>
        {showStatus ? (
          <span className="rounded-full bg-forest/10 px-2.5 py-0.5 font-sans text-xs font-semibold text-forest">
            {CUSTOMER_STATUS[group.status] ?? group.status}
          </span>
        ) : null}
      </summary>
      <div className="mt-3 space-y-4">
        {group.properties.map((p) => (
          <div key={p.id} className="space-y-2">
            <div>
              <h3 className="font-semibold text-charcoal">{p.label}</h3>
              {p.address ? (
                <p className="text-sm break-words text-charcoal/60">{p.address}</p>
              ) : null}
            </div>
            <QuoteList quotes={p.quotes} />
          </div>
        ))}
        {group.otherQuotes.length > 0 ? (
          <div className="space-y-2">
            <h3 className="font-semibold text-charcoal">Other quotes</h3>
            <QuoteList quotes={group.otherQuotes} />
          </div>
        ) : null}
        {group.properties.length === 0 && group.otherQuotes.length === 0 ? (
          <p className="text-sm text-charcoal/60">Nothing to show yet.</p>
        ) : null}
      </div>
    </details>
  );
}
