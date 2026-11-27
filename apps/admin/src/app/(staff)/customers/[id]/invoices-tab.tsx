import {
  BILLING_TIMING_LABELS,
  BILLING_TIMINGS,
  formatDateSA,
  formatZAR,
  fromDateString,
  type BillingTiming,
  type listCustomerInvoices,
} from "@ace/core";
import Link from "next/link";
import { secondaryButtonClass } from "@/components/form";
import { Notice, noticeFor } from "@/components/notice";
import { setBillingTimingAction } from "../../invoices/actions";
import { InvoiceStatusBadge } from "../../invoices/status-badge";

type Data = Awaited<ReturnType<typeof listCustomerInvoices>>;

const NOTICES = {
  "timing-saved": { text: "Billing timing saved.", ok: true },
  "timing-generic": { text: "That could not be saved. Refresh the page and try again.", ok: false },
};

const day = (value: string) => formatDateSA(fromDateString(value));
const linkButton =
  "inline-flex min-h-10 items-center rounded-full bg-forest px-5 py-2.5 font-display text-sm font-semibold text-cream hover:bg-forest-deep";

export function InvoicesTab({
  customerId,
  billingTiming,
  locked,
  data,
  notice,
}: {
  customerId: string;
  billingTiming: BillingTiming;
  /** Archived or anonymised: nothing can be changed or started from here. */
  locked: boolean;
  data: Data;
  notice: string | undefined;
}) {
  return (
    <div className="space-y-6">
      <Notice notice={noticeFor(notice, NOTICES)} />

      <section
        className="space-y-3 rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10"
        aria-labelledby="timing-heading"
      >
        <h2 id="timing-heading" className="font-display text-lg font-semibold text-forest">
          Billing timing
        </h2>
        <p className="text-sm text-charcoal/70">
          Pre: the run on the 20th bills next month, due at the end of this month. Post: it bills
          this month, due on the 25th.
        </p>
        {locked ? (
          <p className="text-sm">{BILLING_TIMING_LABELS[billingTiming]}</p>
        ) : (
          <form action={setBillingTimingAction} className="space-y-2">
            <input type="hidden" name="customerId" value={customerId} />
            <fieldset className="space-y-1">
              <legend className="sr-only">Billing timing</legend>
              {BILLING_TIMINGS.map((t) => (
                <label key={t} className="flex min-h-10 items-center gap-3 text-sm">
                  <input
                    type="radio"
                    name="billingTiming"
                    value={t}
                    defaultChecked={t === billingTiming}
                    className="h-4 w-4 accent-forest"
                  />
                  {BILLING_TIMING_LABELS[t]}
                </label>
              ))}
            </fieldset>
            <button type="submit" className={secondaryButtonClass}>
              Save billing timing
            </button>
          </form>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="money-heading">
        <h2 id="money-heading" className="font-display text-lg font-semibold text-forest">
          Money
        </h2>
        <p className="text-sm">
          Owed as the payer: <span className="font-semibold">{formatZAR(data.owedCents)}</span>
          {data.creditCents > 0 ? (
            <span className="block text-charcoal/70">
              Credit on account (paid, not yet allocated): {formatZAR(data.creditCents)}
            </span>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-2">
          {!locked ? (
            <Link href={`/invoices/new?customer=${customerId}`} className={linkButton}>
              New invoice
            </Link>
          ) : null}
          <Link href={`/payments/new?payer=${customerId}`} className={secondaryButtonClass}>
            Record payment
          </Link>
          <Link href={`/statements?customer=${customerId}`} className={secondaryButtonClass}>
            Statement
          </Link>
        </div>
      </section>

      <section className="space-y-2" aria-labelledby="invoices-heading">
        <h2 id="invoices-heading" className="font-display text-lg font-semibold text-forest">
          Invoices
        </h2>
        {data.items.length === 0 ? (
          <p className="text-sm text-charcoal/60">No invoices yet.</p>
        ) : (
          <ul className="divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
            {data.items.map((i) => (
              <li key={i.id}>
                <Link
                  href={`/invoices/${i.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-cream/60"
                >
                  <span className="min-w-0 break-words">
                    <span className="font-semibold text-forest">{i.reference ?? "Draft"}</span>
                    <span className="block text-sm text-charcoal/60">
                      {[
                        formatZAR(i.totalCents),
                        i.dueDate ? `due ${day(i.dueDate)}` : null,
                        i.billTo.id !== customerId ? `billed to ${i.billTo.displayName}` : null,
                        i.customer.id !== customerId ? `for ${i.customer.displayName}` : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </span>
                  <InvoiceStatusBadge status={i.displayStatus} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2" aria-labelledby="payments-heading">
        <h2 id="payments-heading" className="font-display text-lg font-semibold text-forest">
          Payments received
        </h2>
        {data.payments.length === 0 ? (
          <p className="text-sm text-charcoal/60">No payments recorded.</p>
        ) : (
          <ul className="divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
            {data.payments.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/payments/${p.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-cream/60"
                >
                  <span className="min-w-0 break-words">
                    <span className="font-semibold">{formatZAR(p.amountCents)}</span>
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
      </section>
    </div>
  );
}
