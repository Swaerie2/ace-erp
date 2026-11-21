import { formatCustomerNumber, formatZAR, getDb, listQuotes, QUOTE_FILTERS } from "@ace/core";
import Link from "next/link";
import { inputClass } from "@/components/auth-card";
import { secondaryButtonClass } from "@/components/form";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { first, positiveInt } from "@/lib/search-params";
import { QuoteStatusBadge } from "./status-badge";

type Param = string | string[] | undefined;
type Search = { q?: Param; status?: Param; page?: Param };

const MAX_QUERY = 100;
const MAX_PAGE = 10_000;
const FILTER_LABELS: Record<"ALL" | (typeof QUOTE_FILTERS)[number], string> = {
  ALL: "All",
  DRAFT: "Draft",
  ISSUED: "Issued",
  EXPIRED: "Expired",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  REPLACED: "Replaced",
  WITHDRAWN: "Withdrawn",
};

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await requireStaff(["OWNER", "MANAGER"]); // every page starts with this
  const sp = await searchParams;
  const actor = await toActor(staff);
  const q = (first(sp.q) ?? "").trim().slice(0, MAX_QUERY);
  const status = QUOTE_FILTERS.find((f) => f === first(sp.status));
  const page = positiveInt(sp.page, MAX_PAGE) ?? 1;
  const result = await listQuotes(getDb(), actor, { q, status, page });

  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const link = (over: { status?: string | undefined; page?: number }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const s = "status" in over ? over.status : status;
    if (s) params.set("status", s);
    if (over.page && over.page > 1) params.set("page", String(over.page));
    const text = params.toString();
    return text ? `/quotes?${text}` : "/quotes";
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-forest">Quotes</h1>
        <Link
          href="/quotes/new"
          className="inline-flex min-h-10 items-center rounded-full bg-forest px-5 py-2.5 font-display text-sm font-semibold text-cream hover:bg-forest-deep"
        >
          New quote
        </Link>
      </div>

      <form method="get" className="mt-6 flex flex-wrap gap-2">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <input
          name="q"
          defaultValue={q}
          placeholder="Search reference or customer name"
          aria-label="Search quotes"
          className={`${inputClass} mt-0 flex-1 basis-64`}
        />
        <button type="submit" className={secondaryButtonClass}>
          Search
        </button>
      </form>

      <nav className="mt-4 flex flex-wrap gap-2 text-sm font-semibold" aria-label="Status filter">
        {(["ALL", ...QUOTE_FILTERS] as const).map((f) => {
          const active = f === "ALL" ? !status : f === status;
          return (
            <Link
              key={f}
              href={link({ status: f === "ALL" ? undefined : f })}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-10 items-center rounded-full px-4 ${active ? "bg-forest text-cream" : "bg-white/70 text-forest ring-1 ring-charcoal/10 hover:bg-cream"}`}
            >
              {FILTER_LABELS[f]}
            </Link>
          );
        })}
      </nav>

      {page > pages ? (
        <p className="mt-10 text-center text-charcoal/60">
          That page does not exist.{" "}
          <Link href={link({ page: 1 })} className="text-forest underline">
            Go to page 1
          </Link>
        </p>
      ) : result.items.length === 0 ? (
        <p className="mt-10 text-center text-charcoal/60">
          {q || status ? "No quotes match that search or filter." : "No quotes yet."}
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
          {result.items.map((item) => {
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
                    <span className="ml-2 text-sm text-charcoal">{item.customer.displayName}</span>
                    <span className="ml-2 text-xs text-charcoal/50">
                      {formatCustomerNumber(item.customer.number)}
                    </span>
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

      {pages > 1 ? (
        <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Pages">
          {page > 1 ? (
            <Link
              href={link({ page: page - 1 })}
              className="inline-flex min-h-10 items-center px-2 text-forest hover:underline"
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-charcoal/60">
            Page {page} of {pages} ({result.total} quotes)
          </span>
          {page < pages ? (
            <Link
              href={link({ page: page + 1 })}
              className="inline-flex min-h-10 items-center px-2 text-forest hover:underline"
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
