import { INVOICE_STATUS_LABELS, type InvoiceDisplayStatus } from "@ace/core";

const STYLES: Record<InvoiceDisplayStatus, string> = {
  DRAFT: "bg-charcoal/10 text-charcoal/70",
  UNPAID: "bg-forest/10 text-forest",
  PART_PAID: "bg-ochre/15 text-ochre",
  PAID: "bg-forest text-cream",
  OVERDUE: "bg-red-50 text-red-800",
  VOID: "bg-charcoal/10 text-charcoal/50",
};

export function InvoiceStatusBadge({ status }: { status: InvoiceDisplayStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STYLES[status]}`}>
      {INVOICE_STATUS_LABELS[status]}
    </span>
  );
}
