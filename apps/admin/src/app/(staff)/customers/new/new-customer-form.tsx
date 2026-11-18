"use client";

import { formatCustomerNumber } from "@ace/core/client";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { buttonClass } from "@/components/auth-card";
import { FormMessage } from "@/components/form";
import { ContactFields } from "../_components/contact-fields";
import { CustomerFields } from "../_components/customer-fields";
import { PropertyFields } from "../_components/property-fields";
import { createCustomerAction } from "../actions";

const INITIAL = {
  receivesQuotes: "on",
  receivesInvoices: "on",
  contact_receivesQuotes: "on",
  contact_receivesInvoices: "on",
};

export function NewCustomerForm() {
  const [state, action, pending] = useActionState(createCustomerAction, undefined);
  const values = state?.values ?? INITIAL;
  const errors = state?.fieldErrors ?? {};
  const formRef = useRef<HTMLFormElement>(null);

  // After each response, bring the message into view and move focus to it, so the
  // remount of the fields does not leave the user at the top of the page.
  useEffect(() => {
    if (state?.nonce === undefined) return;
    const form = formRef.current;
    if (!form) return;
    // The duplicate warning or the form-level error: direct children of the form.
    const box = form.querySelector<HTMLElement>(":scope > [role='alert']");
    const target = box ?? form.querySelector<HTMLElement>("[aria-invalid='true']");
    if (!target) return;
    if (box) box.tabIndex = -1;
    target.focus();
    target.scrollIntoView({ block: "center" });
  }, [state?.nonce]);

  return (
    <form ref={formRef} action={action} className="mt-6 space-y-8">
      <div key={state?.nonce ?? "initial"} className="space-y-8">
        <CustomerFields values={values} errors={errors} autoFocus={state === undefined} />
        <section className="space-y-4">
          <h2 className="font-display text-lg font-semibold text-forest">First contact</h2>
          <ContactFields values={values} errors={errors} prefix="contact_" />
        </section>
        <section className="space-y-4">
          <h2 className="font-display text-lg font-semibold text-forest">
            First property (optional)
          </h2>
          <PropertyFields values={values} errors={errors} prefix="property_" />
        </section>
      </div>

      {state?.duplicates?.length ? (
        <div
          role="alert"
          className="space-y-2 rounded-xl bg-ochre/10 p-4 text-sm text-charcoal ring-1 ring-ochre/30"
        >
          <p className="font-semibold">This email or phone is already on another customer:</p>
          <ul className="list-disc pl-5">
            {state.duplicates.map((d) => (
              <li key={d.customerId}>
                <Link
                  href={`/customers/${d.customerId}`}
                  className="text-forest underline"
                  target="_blank"
                >
                  {d.displayName} ({formatCustomerNumber(d.number)})
                </Link>{" "}
                matched by {d.reason}
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="confirmDuplicates" value="1" required />
            Save anyway, this is a different customer
          </label>
        </div>
      ) : null}

      <FormMessage error={state?.error} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Saving…" : "Save customer"}
      </button>
    </form>
  );
}
