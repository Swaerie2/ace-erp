"use client";

import { formatCustomerNumber } from "@ace/core/client";
import Link from "next/link";
import { useActionState, useRef } from "react";
import { buttonClass } from "@/components/auth-card";
import { FormMessage, SelectField, TextField } from "@/components/form";
import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { quickAddQuoteAction } from "../actions";

const TYPES = [
  { value: "PERSON", label: "Homeowner" },
  { value: "COMPANY", label: "Business or body corporate" },
];

export function QuickAddForm() {
  const [state, action, pending] = useActionState(quickAddQuoteAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  const v = state?.values ?? { type: "PERSON" };
  const e = state?.fieldErrors ?? {};

  return (
    <form ref={formRef} action={action} className="mt-4 space-y-4">
      <div key={state?.nonce ?? "initial"} className="space-y-4">
        <SelectField
          label="Type"
          name="type"
          options={TYPES}
          defaultValue={v.type}
          error={e.type}
        />
        <TextField
          label="Name"
          name="displayName"
          required
          defaultValue={v.displayName}
          error={e.displayName}
          autoComplete="off"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Mobile number"
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={v.phone}
            error={e.phone}
            hint="A mobile number or an email is needed."
          />
          <TextField
            label="Email"
            name="email"
            type="email"
            inputMode="email"
            defaultValue={v.email}
            error={e.email}
          />
        </div>
        <TextField
          label="Street address of the property"
          name="addressLine1"
          required
          defaultValue={v.addressLine1}
          error={e.addressLine1}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Suburb" name="suburb" defaultValue={v.suburb} error={e.suburb} />
          <TextField label="City" name="city" defaultValue={v.city} error={e.city} />
        </div>
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
                  rel="noopener noreferrer"
                >
                  {d.displayName} ({formatCustomerNumber(d.number)})
                  <span className="sr-only"> (opens in a new tab)</span>
                </Link>{" "}
                matched by {d.reason}
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="confirmDuplicates" value="1" required />
            Continue anyway, this is a different customer
          </label>
        </div>
      ) : null}

      <FormMessage error={state?.error} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Starting…" : "Add prospect and start quote"}
      </button>
    </form>
  );
}
