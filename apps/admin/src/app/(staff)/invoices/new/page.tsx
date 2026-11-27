import {
  formatCustomerNumber,
  formatZAR,
  getCustomer,
  getDb,
  listAcceptedOnceOffQuotes,
  listCustomers,
} from "@ace/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { inputClass } from "@/components/auth-card";
import { secondaryButtonClass } from "@/components/form";
import { Notice, noticeFor, type NoticeText } from "@/components/notice";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { first } from "@/lib/search-params";
import { createOnceOffAction } from "../actions";

type Param = string | string[] | undefined;

const NOTICES: Record<string, NoticeText> = {
  "quote-invoiced": { text: "That quote has already been invoiced.", ok: false },
  archived: { text: "Restore this customer before invoicing.", ok: false },
  cannot: { text: "That could not be done. Refresh the page and try again.", ok: false },
};

const backLinkClass = "inline-flex min-h-10 items-center text-sm text-forest hover:underline";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: Param; q?: Param; notice?: Param }>;
}) {
  const staff = await requireStaff(["OWNER", "MANAGER"]); // every page starts with this
  const sp = await searchParams;
  const actor = await toActor(staff);
  const db = getDb();
  const picked = z.uuid().safeParse(first(sp.customer));

  if (!picked.success) {
    const q = (first(sp.q) ?? "").trim().slice(0, 100);
    const found = q ? await listCustomers(db, actor, { q, pageSize: 20 }) : null;
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Link href="/invoices" className={backLinkClass}>
          ← Invoices
        </Link>
        <h1 className="font-display text-2xl font-semibold text-forest">New once-off invoice</h1>
        <p className="text-sm text-charcoal/70">Find the customer the work was for.</p>
        <form method="get" role="search" className="flex flex-wrap gap-2">
          <input
            name="q"
            defaultValue={q}
            maxLength={100}
            placeholder="Customer name, number or email"
            aria-label="Find a customer"
            className={`${inputClass} mt-0 min-h-10 min-w-0 flex-1 basis-56`}
          />
          <button type="submit" className={secondaryButtonClass}>
            Search
          </button>
        </form>
        {found ? (
          found.items.length === 0 ? (
            <p className="text-sm text-charcoal/60">No customer matches that search.</p>
          ) : (
            <ul className="divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
              {found.items.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/invoices/new?customer=${c.id}`}
                    className="flex min-h-10 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-cream/60"
                  >
                    <span className="min-w-0 break-words font-semibold text-forest">
                      {c.displayName}
                    </span>
                    <span className="text-xs text-charcoal/50">
                      {formatCustomerNumber(c.number)}
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

  const customer = await getCustomer(db, actor, picked.data);
  if (!customer) notFound();
  const locked = customer.status === "ARCHIVED" || Boolean(customer.anonymisedAt);
  const quotes = locked ? [] : await listAcceptedOnceOffQuotes(db, actor, customer.id);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href={`/customers/${customer.id}?tab=invoices`} className={backLinkClass}>
        <span className="min-w-0 break-words">← {customer.displayName}</span>
      </Link>
      <h1 className="font-display text-2xl font-semibold text-forest">New invoice</h1>
      <Notice notice={noticeFor(first(sp.notice), NOTICES)} />
      {locked ? (
        <p className="text-sm text-charcoal/70">
          This customer is archived or anonymised and cannot be invoiced.
        </p>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="font-display text-lg font-semibold text-forest">
              From an accepted quote
            </h2>
            {quotes.length === 0 ? (
              <p className="text-sm text-charcoal/60">No accepted quote with once-off work.</p>
            ) : (
              <ul className="space-y-2">
                {quotes.map((q) => (
                  <li
                    key={q.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10"
                  >
                    <span className="min-w-0 break-words">
                      <span className="font-semibold text-forest">{q.reference}</span>
                      <span className="block text-sm text-charcoal/60">
                        {q.propertyLabel}, once-off work {formatZAR(q.onceOffCents)}
                      </span>
                    </span>
                    {q.alreadyInvoiced ? (
                      <span className="text-sm text-charcoal/60">Already invoiced</span>
                    ) : (
                      <form action={createOnceOffAction}>
                        <input type="hidden" name="customerId" value={customer.id} />
                        <input type="hidden" name="quoteId" value={q.id} />
                        <button type="submit" className={secondaryButtonClass}>
                          Invoice this quote
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="space-y-2">
            <h2 className="font-display text-lg font-semibold text-forest">
              Or type the lines yourself
            </h2>
            <p className="text-sm text-charcoal/60">
              An empty draft opens. Nothing is sent until you issue it.
            </p>
            <form action={createOnceOffAction}>
              <input type="hidden" name="customerId" value={customer.id} />
              <button type="submit" className={secondaryButtonClass}>
                Start an empty invoice
              </button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
