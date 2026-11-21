import { formatZAR, type listQuotes } from "@ace/core";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { QuoteStatusBadge } from "../../quotes/status-badge";

type Result = Awaited<ReturnType<typeof listQuotes>>;

export function QuotesTab({
  customerId,
  customerName,
  result,
  canQuote,
}: {
  customerId: string;
  customerName: string;
  result: Pick<Result, "items" | "total">;
  canQuote: boolean;
}) {
  const { items, total } = result;
  return (
    <div className="space-y-4">
      {canQuote ? (
        <Link
          href={`/quotes/new?customer=${customerId}`}
          className="inline-flex min-h-10 items-center rounded-full bg-forest px-5 py-2.5 font-display text-sm font-semibold text-cream hover:bg-forest-deep"
        >
          New quote
        </Link>
      ) : null}
      {items.length === 0 ? (
        <p className="text-charcoal/60">No quotes yet.</p>
      ) : (
        <ul className="divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
          {items.map((item) => {
            const amounts = [
              item.totals.monthly > 0 ? `${formatZAR(item.totals.monthly)} per month` : null,
              item.totals.onceOff > 0 ? `${formatZAR(item.totals.onceOff)} once-off` : null,
            ]
              .filter(Boolean)
              .join(" + ");
            return (
              <li key={item.id}>
                <Link
                  href={`/quotes/${item.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-cream/60"
                >
                  <span className="min-w-0 break-words">
                    <span className="font-semibold text-forest">{item.reference ?? "Draft"}</span>
                    <span className="block text-sm text-charcoal/60">
                      {[item.siteLabel, amounts, `valid until ${formatDate(item.validUntil)}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <QuoteStatusBadge status={item.displayStatus} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {total > items.length ? (
        <p className="text-sm text-charcoal/70">
          Showing the latest {items.length} of {total}.{" "}
          <Link
            href={`/quotes?q=${encodeURIComponent(customerName.slice(0, 100))}`}
            className="inline-flex min-h-10 items-center text-forest underline"
          >
            See all
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
