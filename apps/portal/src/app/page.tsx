import { getPortalDb } from "@ace/core";
import { getPortalHome } from "@ace/core/portal";
import type { Metadata } from "next";
import { fieldClass, secondaryButtonClass } from "@/components/form-classes";
import { SignedInShell } from "@/components/signed-in-shell";
import { requireSession } from "@/lib/session";
import { CustomerGroup } from "./home-groups";

export const metadata: Metadata = {
  title: "Your quotes from ACE Garden Services",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  // Trimmed and capped here; core caps it again and only uses it to filter names inside the scope.
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const home = await getPortalHome(getPortalDb(), session.scope, { q });
  // Collapsed by default when there are many groups.
  const open = home.groups.length <= 3;
  return (
    <SignedInShell>
      <h1 className="font-display text-2xl font-semibold text-forest">
        {home.hasManaged ? "My complexes" : "Your quotes"}
      </h1>
      {home.hasManaged ? (
        <form method="get" role="search" className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="q" className="text-sm font-semibold text-charcoal">
              Search by complex name
            </label>
            <input
              id="q"
              name="q"
              type="search"
              maxLength={80}
              defaultValue={q}
              className={fieldClass}
            />
          </div>
          <button type="submit" className={secondaryButtonClass}>
            Search
          </button>
        </form>
      ) : null}
      {home.groups.length === 0 ? (
        <p className="text-charcoal/70">
          {q ? "No complex matches that name." : "There is nothing to show yet."}
        </p>
      ) : (
        home.groups.map((g) => (
          <CustomerGroup key={g.id} group={g} open={open} agencyView={home.hasManaged} />
        ))
      )}
    </SignedInShell>
  );
}
