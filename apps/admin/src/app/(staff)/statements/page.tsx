import {
  defaultStatementPeriod,
  getDb,
  listCustomers,
  loadStatementDocument,
  statementPeriodProblem,
  todaySA,
} from "@ace/core";
import { StatementDocumentView } from "@ace/ui/invoice-document";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { inputClass } from "@/components/auth-card";
import { CustomerSearchForm, searchItems } from "@/components/customer-search";
import { secondaryButtonClass } from "@/components/form";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { first } from "@/lib/search-params";

type Param = string | string[] | undefined;

const backLinkClass = "inline-flex min-h-10 items-center text-sm text-forest hover:underline";
const INVALID_DATE = "Choose a valid date.";

/**
 * Core's period problem, placed next to the box it is about: a bad date on its own box, an end before the
 * start (or a period that is too long) on the "To" box.
 */
function periodErrors(from: string, to: string): { from?: string; to?: string } | null {
  const problem = statementPeriodProblem(from, to);
  if (!problem) return null;
  // A one-day period has no problem exactly when the date itself is valid.
  const fromBad = statementPeriodProblem(from, from) !== null;
  const toBad = statementPeriodProblem(to, to) !== null;
  if (fromBad || toBad) {
    return { ...(fromBad ? { from: INVALID_DATE } : {}), ...(toBad ? { to: INVALID_DATE } : {}) };
  }
  return { to: problem };
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? (
    <span role="alert" className="mt-1 block text-xs font-normal text-red-700">
      {message}
    </span>
  ) : null;
}

export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: Param; q?: Param; from?: Param; to?: Param }>;
}) {
  const staff = await requireStaff(["OWNER", "MANAGER"]); // every page starts with this
  const sp = await searchParams;
  const actor = await toActor(staff);
  const db = getDb();
  const picked = z.uuid().safeParse(first(sp.customer));

  if (!picked.success) {
    const q = (first(sp.q) ?? "").trim().slice(0, 100);
    // Archived customers can still be sent a statement, so they are found too.
    const found = q ? await listCustomers(db, actor, { q, status: "ALL", pageSize: 20 }) : null;
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="font-display text-2xl font-semibold text-forest">Statements</h1>
        <p className="text-sm text-charcoal/70">
          A statement is for the customer who pays. For an agency it lists every complex billed to
          it.
        </p>
        <CustomerSearchForm
          basePath="/statements"
          param="customer"
          q={q}
          items={found ? searchItems(found.items) : null}
        />
      </div>
    );
  }

  const customerId = picked.data;
  const fallback = defaultStatementPeriod(todaySA());
  const from = first(sp.from) ?? fallback.from;
  const to = first(sp.to) ?? fallback.to;
  const errors = periodErrors(from, to);
  const loaded = errors ? null : await loadStatementDocument(db, actor, customerId, { from, to });
  if (!errors && !loaded) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/statements" className={backLinkClass}>
        ← Statements
      </Link>
      <h1 className="break-words font-display text-2xl font-semibold text-forest">
        {loaded ? `Statement for ${loaded.doc.customer.name}` : "Statement"}
      </h1>
      <form method="get" className="flex flex-wrap items-start gap-3">
        <input type="hidden" name="customer" value={customerId} />
        <label className="block min-w-0 flex-1 basis-36 text-sm font-medium text-charcoal">
          From
          <input
            type="date"
            name="from"
            defaultValue={from}
            required
            aria-invalid={errors?.from ? true : undefined}
            className={`${inputClass} min-h-10`}
          />
          <FieldError message={errors?.from} />
        </label>
        <label className="block min-w-0 flex-1 basis-36 text-sm font-medium text-charcoal">
          To
          <input
            type="date"
            name="to"
            defaultValue={to}
            required
            aria-invalid={errors?.to ? true : undefined}
            className={`${inputClass} min-h-10`}
          />
          <FieldError message={errors?.to} />
        </label>
        <button type="submit" className={`${secondaryButtonClass} mt-6 min-h-10`}>
          Show
        </button>
      </form>
      {loaded ? (
        <>
          <div className="flex flex-wrap gap-2">
            {/* from and to are valid dates here: statementPeriodProblem returned null for them. */}
            <a
              href={`/statements/${customerId}/pdf?from=${from}&to=${to}`}
              target="_blank"
              rel="noopener noreferrer"
              className={secondaryButtonClass}
            >
              Download PDF<span className="sr-only"> (opens in a new tab)</span>
            </a>
            <Link href={`/customers/${customerId}?tab=invoices`} className={secondaryButtonClass}>
              Open the customer
            </Link>
          </div>
          <div className="min-w-0 overflow-x-auto">
            <StatementDocumentView
              doc={loaded.doc}
              logoSrc={
                loaded.doc.logoVersion
                  ? `/company-logo?v=${encodeURIComponent(loaded.doc.logoVersion)}`
                  : null
              }
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
