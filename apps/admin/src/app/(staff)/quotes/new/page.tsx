import { formatCustomerNumber, getCustomer, getDb, listCustomers } from "@ace/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { inputClass } from "@/components/auth-card";
import { secondaryButtonClass } from "@/components/form";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { first } from "@/lib/search-params";
import { createQuoteAction } from "../actions";
import { QuickAddForm } from "./quick-add-form";

type Param = string | string[] | undefined;
type Search = { customer?: Param; q?: Param; error?: Param };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await requireStaff(["OWNER", "MANAGER"]);
  const actor = await toActor(staff);
  const sp = await searchParams;
  const customerParam = first(sp.customer);
  const q = (first(sp.q) ?? "").trim().slice(0, 100);

  const back = (
    <Link
      href="/quotes"
      className="inline-flex min-h-10 items-center text-sm text-forest hover:underline"
    >
      ← Quotes
    </Link>
  );

  if (customerParam) {
    if (!z.uuid().safeParse(customerParam).success) notFound();
    const customer = await getCustomer(getDb(), actor, customerParam);
    if (!customer || customer.anonymisedAt) notFound();
    const archived = customer.status === "ARCHIVED";
    return (
      <div className="mx-auto max-w-2xl">
        {back}
        <h1 className="mt-2 font-display text-2xl font-semibold text-forest">New quote</h1>
        <p className="mt-1 text-charcoal">
          {customer.displayName}{" "}
          <span className="text-sm text-charcoal/50">{formatCustomerNumber(customer.number)}</span>
        </p>
        {first(sp.error) ? (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
          >
            That quote could not be started. Check the customer and property, then try again.
          </p>
        ) : null}
        {archived ? (
          <p className="mt-6 text-charcoal/70">
            This customer is archived. Restore the customer before quoting.
          </p>
        ) : customer.properties.length === 0 ? (
          <p className="mt-6 text-charcoal/70">
            This customer has no property yet.{" "}
            <Link
              href={`/customers/${customer.id}?tab=properties&add=1`}
              className="text-forest underline"
            >
              Add a property
            </Link>{" "}
            first.
          </p>
        ) : (
          <>
            <p className="mt-6 text-sm text-charcoal/70">Choose the property this quote is for.</p>
            <ul className="mt-3 space-y-3">
              {customer.properties.map((p) => (
                <li key={p.id} className="rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10">
                  <p className="font-semibold text-forest">{p.label}</p>
                  <p className="break-words text-sm text-charcoal/70">
                    {[p.addressLine1, p.suburb, p.city].filter(Boolean).join(", ")}
                  </p>
                  <form action={createQuoteAction} className="mt-3">
                    <input type="hidden" name="customerId" value={customer.id} />
                    <input type="hidden" name="propertyId" value={p.id} />
                    <button
                      type="submit"
                      className="min-h-10 rounded-full bg-forest px-5 py-2 font-display text-sm font-semibold text-cream hover:bg-forest-deep"
                      aria-label={`Start a quote for ${p.label}`}
                    >
                      Start quote
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  const found = q ? await listCustomers(getDb(), actor, { q, pageSize: 10 }) : null;
  return (
    <div className="mx-auto max-w-2xl">
      {back}
      <h1 className="mt-2 font-display text-2xl font-semibold text-forest">New quote</h1>

      <section className="mt-6">
        <h2 className="font-display text-lg font-semibold text-forest">Existing customer</h2>
        <form method="get" className="mt-3 flex flex-wrap gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name, number, phone, email, address"
            aria-label="Search customers"
            className={`${inputClass} mt-0 flex-1 basis-64`}
          />
          <button type="submit" className={secondaryButtonClass}>
            Search
          </button>
        </form>
        {found ? (
          found.items.length === 0 ? (
            <p className="mt-4 text-charcoal/60">No customers match that search.</p>
          ) : (
            <ul className="mt-4 divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
              {found.items.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/quotes/new?customer=${c.id}`}
                    className="flex min-h-12 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-cream/60"
                  >
                    <span className="font-semibold text-forest">{c.displayName}</span>
                    <span className="text-xs text-charcoal/50">
                      {formatCustomerNumber(c.number)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>

      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold text-forest">New prospect</h2>
        <p className="mt-1 text-sm text-charcoal/70">
          Quick add: this creates a lead with one contact and one property, then starts the quote.
        </p>
        <QuickAddForm />
      </section>
    </div>
  );
}
