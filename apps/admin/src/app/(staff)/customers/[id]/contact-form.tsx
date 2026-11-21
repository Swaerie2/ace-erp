"use client";

import { formatCustomerNumber } from "@ace/core/client";
import Link from "next/link";
import { useActionState, useRef } from "react";
import { buttonClass } from "@/components/auth-card";
import { FormMessage } from "@/components/form";
import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { ContactFields } from "../_components/contact-fields";
import { saveContactAction } from "../actions";

export type ContactRow = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  receivesQuotes: boolean;
  receivesInvoices: boolean;
  portalAccess: boolean;
};

function toValues(c?: ContactRow): Record<string, string> {
  if (!c) return { receivesQuotes: "on", receivesInvoices: "on" };
  const v: Record<string, string> = { name: c.name };
  if (c.role) v.role = c.role;
  if (c.email) v.email = c.email;
  if (c.phone) v.phone = c.phone;
  if (c.receivesQuotes) v.receivesQuotes = "on";
  if (c.receivesInvoices) v.receivesInvoices = "on";
  if (c.portalAccess) v.portalAccess = "on";
  return v;
}

export function ContactForm({ customerId, contact }: { customerId: string; contact?: ContactRow }) {
  const [state, action, pending] = useActionState(saveContactAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);

  return (
    <form
      ref={formRef}
      action={action}
      className="space-y-5 rounded-2xl bg-white/70 p-5 ring-1 ring-charcoal/10"
    >
      <input type="hidden" name="customerId" value={customerId} />
      {contact ? <input type="hidden" name="contactId" value={contact.id} /> : null}
      <div key={state?.nonce ?? "initial"}>
        <ContactFields
          values={state?.values ?? toValues(contact)}
          errors={state?.fieldErrors ?? {}}
        />
      </div>
      {state?.duplicates?.length ? (
        <div
          role="alert"
          className="space-y-2 rounded-xl bg-ochre/10 p-4 text-sm ring-1 ring-ochre/30"
        >
          <p className="font-semibold">This email or phone is already on another customer:</p>
          <ul className="list-disc pl-5">
            {state.duplicates.map((d) => (
              <li key={d.customerId}>
                <Link
                  href={`/customers/${d.customerId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-forest underline"
                >
                  {d.displayName} ({formatCustomerNumber(d.number)})
                  <span className="sr-only"> (opens in a new tab)</span>
                </Link>
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="confirmDuplicates" value="1" required /> Save anyway
          </label>
        </div>
      ) : null}
      <FormMessage error={state?.error} />
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : "Save contact"}
        </button>
        <Link
          href={`/customers/${customerId}?tab=contacts`}
          className="self-center text-sm text-forest hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
