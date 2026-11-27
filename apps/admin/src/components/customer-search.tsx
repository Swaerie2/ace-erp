import { formatCustomerNumber } from "@ace/core";
import Link from "next/link";
import { inputClass } from "@/components/auth-card";
import { secondaryButtonClass } from "@/components/form";

/** Only what the result list shows: never contacts, addresses or gate codes. */
export type CustomerSearchItem = {
  id: string;
  number: number;
  displayName: string;
  status: string;
};

/** Turns core's customer list rows into the few fields the search results show. */
export function searchItems(
  rows: readonly { id: string; number: number; displayName: string; status: string }[],
): CustomerSearchItem[] {
  return rows.map((c) => ({
    id: c.id,
    number: c.number,
    displayName: c.displayName,
    status: c.status,
  }));
}

/**
 * Search for a customer (a GET form); each result links to `<basePath>?<param>=<customer id>`. A server
 * component: the links are built from the plain strings `basePath` and `param`.
 */
export function CustomerSearchForm({
  basePath,
  param,
  q,
  items,
}: {
  basePath: string;
  param: string;
  q: string;
  items: CustomerSearchItem[] | null;
}) {
  return (
    <div className="space-y-3">
      <form method="get" role="search" className="flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={q}
          maxLength={100}
          placeholder="Customer name, number or email"
          aria-label="Find a customer"
          className={`${inputClass} mt-0 min-h-10 min-w-0 flex-1 basis-56`}
        />
        <button type="submit" className={`${secondaryButtonClass} min-h-10`}>
          Search
        </button>
      </form>
      {items ? (
        items.length === 0 ? (
          <p className="text-sm text-charcoal/60">No customer matches that search.</p>
        ) : (
          <ul className="divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
            {items.map((c) => (
              <li key={c.id}>
                <Link
                  href={`${basePath}?${param}=${encodeURIComponent(c.id)}`}
                  className="flex min-h-10 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-cream/60"
                >
                  <span className="min-w-0 break-words font-semibold text-forest">
                    {c.displayName}
                  </span>
                  <span className="text-xs text-charcoal/50">
                    {formatCustomerNumber(c.number)}
                    {c.status === "ARCHIVED" ? ", archived" : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
