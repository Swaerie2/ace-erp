import { PORTAL_ACCESS_MESSAGES, type getCustomer } from "@ace/core";
import Link from "next/link";
import { secondaryButtonClass } from "@/components/form";
import { formatDate } from "@/lib/format";
import { inviteContactAction, removeContactAccessAction, removeContactAction } from "../actions";
import { ContactForm, type ContactRow } from "./contact-form";

type Customer = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;
type Contact = Customer["contacts"][number];

/** The address bar only carries a fixed code; nothing else from the URL is ever shown. */
const NOTICES: Record<string, { text: string; tone: "error" | "good" | "warn" }> = {
  "last-contact": { text: "A customer needs at least one contact.", tone: "error" },
  generic: { text: "Could not remove that contact.", tone: "error" },
  invited: { text: "Portal access given and the welcome email sent.", tone: "good" },
  "invite-failed": {
    text: "Portal access given, but the welcome email could not be sent. Press the invite button again later.",
    tone: "warn",
  },
  removed: { text: "Portal access removed for this contact.", tone: "good" },
  "no-email": { text: PORTAL_ACCESS_MESSAGES.noEmail, tone: "error" },
  archived: { text: PORTAL_ACCESS_MESSAGES.archived, tone: "error" },
  "portal-generic": {
    text: "That could not be done. Refresh the page and try again.",
    tone: "error",
  },
};

const TONES = {
  error: "bg-red-50 text-red-800 ring-red-200",
  good: "bg-forest/10 text-forest ring-forest/25",
  warn: "bg-ochre/10 text-charcoal ring-ochre/30",
} as const;

/** Only these fields cross to the browser. */
function toRow(c: Contact): ContactRow {
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    email: c.email,
    phone: c.phone,
    receivesQuotes: c.receivesQuotes,
    receivesInvoices: c.receivesInvoices,
  };
}

/**
 * The Portal line: access on or off, when they were invited, whether the welcome page is done, and the
 * last sign-in. A contact invited before invitations were recorded simply shows "not invited yet".
 */
function portalLine(c: Contact): string {
  if (!c.portalAccess && !c.portalInvitedAt) return "Portal: off";
  return [
    c.portalAccess ? "Portal: on" : "Portal: off",
    c.portalInvitedAt ? `invited ${formatDate(c.portalInvitedAt)}` : "not invited yet",
    c.portalWelcomedAt ? `welcome done ${formatDate(c.portalWelcomedAt)}` : "welcome not done",
    c.lastSignedInAt ? `last signed in ${formatDate(c.lastSignedInAt)}` : "never signed in",
  ].join(" · ");
}

function PortalControls({ customerId, c }: { customerId: string; c: Contact }) {
  const again = c.portalAccess && Boolean(c.portalInvitedAt);
  return (
    <div className="mt-2 flex flex-wrap items-start gap-2">
      {c.email ? (
        <form action={inviteContactAction}>
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="contactId" value={c.id} />
          <button type="submit" className={secondaryButtonClass}>
            {again ? "Send the welcome again" : "Invite to portal"}
            <span className="sr-only"> for {c.name}</span>
          </button>
        </form>
      ) : null}
      {c.portalAccess ? (
        <details className="rounded-2xl ring-1 ring-charcoal/10">
          <summary className="flex min-h-10 cursor-pointer items-center px-4 text-sm font-semibold text-charcoal">
            Remove access
            <span className="sr-only"> for {c.name}</span>
          </summary>
          <form action={removeContactAccessAction} className="space-y-2 px-4 pb-3">
            <p className="text-sm text-charcoal/70">
              They can no longer sign in to the portal, and their sign-ins end at once.
            </p>
            <input type="hidden" name="customerId" value={customerId} />
            <input type="hidden" name="contactId" value={c.id} />
            <button type="submit" className={secondaryButtonClass}>
              Yes, remove portal access
            </button>
          </form>
        </details>
      ) : null}
    </div>
  );
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
  const message = notice && Object.hasOwn(NOTICES, notice) ? NOTICES[notice] : undefined;
  const editing = locked ? undefined : customer.contacts.find((c) => c.id === edit);

  if (add && !locked) return <ContactForm customerId={customer.id} />;
  if (editing) return <ContactForm customerId={customer.id} contact={toRow(editing)} />;

  return (
    <div className="space-y-4">
      {message ? (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`rounded-lg px-3 py-2 text-sm ring-1 ${TONES[message.tone]}`}
        >
          {message.text}
        </p>
      ) : null}
      <ul className="divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
        {customer.contacts.map((c) => (
          <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
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
                {[c.receivesQuotes && "quotes", c.receivesInvoices && "invoices"]
                  .filter(Boolean)
                  .join(" · ") || "no messages"}
              </p>
              <p className="mt-1 text-xs text-charcoal/60">{portalLine(c)}</p>
              {locked ? null : <PortalControls customerId={customer.id} c={c} />}
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
