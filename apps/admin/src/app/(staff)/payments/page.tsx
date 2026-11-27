import {
  formatDateSA,
  formatZAR,
  fromDateString,
  getDb,
  listPaymentReports,
  listPayments,
} from "@ace/core";
import Link from "next/link";
import { secondaryButtonClass } from "@/components/form";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { positiveInt } from "@/lib/search-params";

const day = (value: string) => formatDateSA(fromDateString(value));
const pageLinkClass = "inline-flex min-h-10 items-center px-2 text-forest hover:underline";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const staff = await requireStaff(["OWNER", "MANAGER"]); // every page starts with this
  const sp = await searchParams;
  const actor = await toActor(staff);
  const db = getDb();
  const page = positiveInt(sp.page, 10_000) ?? 1;
  const [result, waiting] = await Promise.all([
    listPayments(db, actor, { page }),
    listPaymentReports(db, actor),
  ]);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-forest">Payments</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/payments/reports" className={secondaryButtonClass}>
            Reported payments ({waiting.length} waiting)
          </Link>
          <Link
            href="/payments/new"
            className="inline-flex min-h-10 items-center rounded-full bg-forest px-5 py-2.5 font-display text-sm font-semibold text-cream hover:bg-forest-deep"
          >
            Record a payment
          </Link>
        </div>
      </div>
      <p className="text-sm text-charcoal/70">
        Money received by EFT. Money not allocated to an invoice is credit on account.
      </p>
      {result.items.length === 0 ? (
        <p className="text-center text-charcoal/60">
          {page > 1 ? "Nothing on this page." : "No payments recorded yet."}
        </p>
      ) : (
        <ul className="divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
          {result.items.map((p) => (
            <li key={p.id}>
              <Link
                href={`/payments/${p.id}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-cream/60"
              >
                <span className="min-w-0 break-words">
                  <span className="font-semibold text-forest">{formatZAR(p.amountCents)}</span>
                  <span className="ml-2 text-sm">{p.payer.displayName}</span>
                  <span className="block text-sm text-charcoal/60">
                    {[
                      day(p.receivedOn),
                      p.reference,
                      p.unallocatedCents > 0
                        ? `${formatZAR(p.unallocatedCents)} not allocated`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </span>
                {p.voided ? (
                  <span className="rounded-full bg-charcoal/10 px-2.5 py-1 text-xs font-semibold text-charcoal/50">
                    Void
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 || page > 1 ? (
        <nav className="flex items-center justify-between text-sm" aria-label="Pages">
          {page > 1 ? (
            <Link href={`/payments?page=${Math.min(page - 1, pages)}`} className={pageLinkClass}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-charcoal/60">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={`/payments?page=${page + 1}`} className={pageLinkClass}>
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
