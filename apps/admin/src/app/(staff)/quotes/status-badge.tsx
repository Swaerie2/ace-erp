import type { QuoteDisplayStatus } from "@ace/core";

const LABELS: Record<QuoteDisplayStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  EXPIRED: "Expired",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  REPLACED: "Replaced",
  WITHDRAWN: "Withdrawn",
};

const STYLES: Record<QuoteDisplayStatus, string> = {
  DRAFT: "bg-charcoal/10 text-charcoal/70",
  ISSUED: "bg-forest/10 text-forest",
  EXPIRED: "bg-ochre/15 text-ochre",
  ACCEPTED: "bg-forest text-cream",
  DECLINED: "bg-red-50 text-red-800",
  REPLACED: "bg-charcoal/10 text-charcoal/50",
  WITHDRAWN: "bg-charcoal/10 text-charcoal/50",
};

export function QuoteStatusBadge({ status }: { status: QuoteDisplayStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
