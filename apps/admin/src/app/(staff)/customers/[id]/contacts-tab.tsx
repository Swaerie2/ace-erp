import type { getCustomer } from "@ace/core";
import Link from "next/link";
import { secondaryButtonClass } from "@/components/form";
import { removeContactAction } from "../actions";
import { ContactForm, type ContactRow } from "./contact-form";

type Customer = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;

/** The address bar only carries a fixed code; nothing else from the URL is ever shown. */
const NOTICES: Record<string, string> = {
  "last-contact": "A customer needs at least one contact.",
  generic: "Could not remove that contact.",
};

/** Only these fields cross to the browser. */
function toRow(c: Customer["contacts"][number]): ContactRow {
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    email: c.email,
    phone: c.phone,
    receivesQuotes: c.receivesQuotes,
    receivesInvoices: c.receivesInvoices,
    portalAccess: c.portalAccess,
  };
}

export function ContactsTab({
  customer,
  edit,
  add,
  notice,
}: {
  customer: Customer;
  edit?: string | undefined;
  add: boolean;
  notice?: string | undefined;
}) {
  const locked = Boolean(customer.anonymisedAt);
  const message = notice ? Object.hasOwn(NOTICES, notice) && NOTICES[notice] : undefined;
  const editing = locked ? undefined : customer.contacts.find((c) => c.id === edit);

  if (add && !locked) return <ContactForm customerId={customer.id} />;
  if (editing) return <ContactForm customerId={customer.id} contact={toRow(editing)} />;

  return (
    <div className="space-y-4">
      {message ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
        >
          {message}
        </p>
      ) : null}
      <ul className="divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
        {customer.contacts.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-semibold text-forest">
                {c.name}
                {c.role ? (
                  <span className="ml-2 text-sm font-normal text-charcoal/60">{c.role}</span>
                ) : null}
              </p>
              <p className="break-words text-sm text-charcoal/70">
                {[c.email, c.phone].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-1 text-xs text-charcoal/50">
                {[
                  c.receivesQuotes && "quotes",
                  c.receivesInvoices && "invoices",
                  c.portalAccess && "portal",
                ]
                  .filter(Boolean)
                  .join(" · ") || "no messages"}
              </p>
            </div>
            {locked ? null : (
              <div className="flex gap-2">
                <Link
                  href={`/customers/${customer.id}?tab=contacts&edit=${c.id}`}
                  className={secondaryButtonClass}
                  aria-label={`Edit ${c.name}`}
                >
                  Edit
                </Link>
                <form action={removeContactAction}>
                  <input type="hidden" name="customerId" value={customer.id} />
                  <input type="hidden" name="contactId" value={c.id} />
                  <button
                    type="submit"
                    className={secondaryButtonClass}
                    aria-label={`Remove ${c.name}`}
                  >
                    Remove
                  </button>
                </form>
              </div>
            )}
          </li>
        ))}
      </ul>
      {locked ? null : (
        <Link
          href={`/customers/${customer.id}?tab=contacts&add=1`}
          className={secondaryButtonClass}
        >
          Add contact
        </Link>
      )}
    </div>
  );
}
