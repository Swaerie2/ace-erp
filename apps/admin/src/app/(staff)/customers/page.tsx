import {
  formatCustomerNumber,
  getDb,
  listCustomers,
  listCustomersForCrew,
  type CustomerStatus,
} from "@ace/core";
import Link from "next/link";
import { inputClass } from "@/components/auth-card";
import { secondaryButtonClass } from "@/components/form";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { first, nonNegativeInt, positiveInt } from "@/lib/search-params";

type Param = string | string[] | undefined;
type Search = { q?: Param; status?: Param; page?: Param; imported?: Param };

const MAX_QUERY = 100;
const MAX_PAGE = 10_000;

const STATUSES = ["LEAD", "ACTIVE", "PAUSED", "ARCHIVED"] as const;

const badge: Record<string, string> = {
  LEAD: "bg-ochre/15 text-ochre",
  ACTIVE: "bg-forest/10 text-forest",
  PAUSED: "bg-charcoal/10 text-charcoal/70",
  ARCHIVED: "bg-charcoal/10 text-charcoal/50",
};

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await requireStaff(); // every page starts with this
  const sp = await searchParams;
  const actor = await toActor(staff);
  const q = (first(sp.q) ?? "").trim().slice(0, MAX_QUERY);
  const page = positiveInt(sp.page, MAX_PAGE) ?? 1;
  const imported = nonNegativeInt(sp.imported);
  const isCrew = staff.role === "CREW";

  const rawStatus = first(sp.status);
  const status = STATUSES.find((s) => s === rawStatus) ?? (rawStatus === "ALL" ? "ALL" : undefined);
  const result = isCrew
    ? await listCustomersForCrew(getDb(), actor, { q, page })
    : await listCustomers(getDb(), actor, {
        q,
        page,
        status: status as CustomerStatus | "ALL" | undefined,
      });

  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const link = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    params.set("page", String(p));
    return `/customers?${params.toString()}`;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-forest">Customers</h1>
        {isCrew ? null : (
          <div className="flex gap-2">
            <Link href="/customers/import" className={secondaryButtonClass}>
              Import CSV
            </Link>
            <Link
              href="/customers/new"
              className="inline-flex items-center rounded-full bg-forest px-5 py-2.5 font-display text-sm font-semibold text-cream hover:bg-forest-deep"
            >
              Add customer
            </Link>
          </div>
        )}
      </div>

      {imported !== undefined ? (
        <p role="status" className="mt-4 rounded-lg bg-forest/10 px-3 py-2 text-sm text-forest">
          Import finished: {imported} {imported === 1 ? "customer" : "customers"} added.
        </p>
      ) : null}

      <form method="get" className="mt-6 flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder={
            isCrew ? "Search name or address" : "Search name, number, phone, email, address"
          }
          aria-label="Search customers"
          className={`${inputClass} mt-0 flex-1 basis-64`}
        />
        {isCrew ? null : (
          <select
            name="status"
            defaultValue={status ?? ""}
            aria-label="Status"
            className={`${inputClass} mt-0 w-auto`}
          >
            <option value="">Not archived</option>
            <option value="ALL">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        )}
        <button type="submit" className={secondaryButtonClass}>
          Search
        </button>
      </form>

      {page > pages ? (
        <p className="mt-10 text-center text-charcoal/60">
          That page does not exist.{" "}
          <Link href={link(1)} className="text-forest underline">
            Go to page 1
          </Link>
        </p>
      ) : result.items.length === 0 ? (
        <p className="mt-10 text-center text-charcoal/60">
          {q || status ? "No customers match that search or filter." : "No customers yet."}
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
          {result.items.map((c) => {
            const first = "contacts" in c ? c.contacts[0] : undefined;
            const places = "_count" in c ? c._count.properties : c.properties.length;
            return (
              <li key={c.id}>
                <Link
                  href={`/customers/${c.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-cream/60"
                >
                  <span className="min-w-0 break-words">
                    <span className="font-semibold text-forest">{c.displayName}</span>
                    <span className="ml-2 text-xs text-charcoal/50">
                      {formatCustomerNumber(c.number)}
                    </span>
                    {first ? (
                      <span className="block text-sm text-charcoal/60">
                        {[first.name, first.phone].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-3 text-xs text-charcoal/60">
                    <span>
                      {places} {places === 1 ? "property" : "properties"}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 font-semibold ${badge[c.status] ?? ""}`}
                    >
                      {c.status.toLowerCase()}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 ? (
        <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Pages">
          {page > 1 ? (
            <Link href={link(page - 1)} className="text-forest hover:underline">
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-charcoal/60">
            Page {page} of {pages} ({result.total} customers)
          </span>
          {page < pages ? (
            <Link href={link(page + 1)} className="text-forest hover:underline">
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
