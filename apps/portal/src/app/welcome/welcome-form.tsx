"use client";

import type { WelcomeStep } from "@ace/core/portal";
import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { useActionState, useRef } from "react";
import { fieldClass, primaryButtonClass } from "@/components/form-classes";
import { completeWelcomeAction } from "./actions";

type Field = { name: string; label: string; max: number; autoComplete: string; optional?: boolean };

const BILLING: Field[] = [
  {
    name: "billingLine1",
    label: "Street address",
    max: 150,
    autoComplete: "address-line1",
    optional: true,
  },
  {
    name: "billingLine2",
    label: "Address line 2",
    max: 150,
    autoComplete: "address-line2",
    optional: true,
  },
  {
    name: "billingSuburb",
    label: "Suburb",
    max: 80,
    autoComplete: "address-level3",
    optional: true,
  },
  {
    name: "billingCity",
    label: "City or town",
    max: 80,
    autoComplete: "address-level2",
    optional: true,
  },
  {
    name: "billingPostalCode",
    label: "Postal code",
    max: 10,
    autoComplete: "postal-code",
    optional: true,
  },
];

export function WelcomeForm({ step }: { step: WelcomeStep }) {
  const [state, action, pending] = useActionState(completeWelcomeAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  const e = state?.fieldErrors ?? {};
  const start: Record<string, string> = {
    name: step.name,
    phone: step.phone ?? "",
    billingLine1: step.billing.billingLine1 ?? "",
    billingLine2: step.billing.billingLine2 ?? "",
    billingSuburb: step.billing.billingSuburb ?? "",
    billingCity: step.billing.billingCity ?? "",
    billingPostalCode: step.billing.billingPostalCode ?? "",
  };
  const v = state?.values ?? start;
  const input = (f: Field, type = "text") => (
    <div key={f.name}>
      <label htmlFor={f.name} className="font-semibold text-charcoal">
        {f.label}
        {f.optional ? <span className="font-normal text-charcoal/60"> (optional)</span> : null}
      </label>
      <input
        id={f.name}
        name={f.name}
        type={type}
        maxLength={f.max}
        autoComplete={f.autoComplete}
        required={!f.optional}
        defaultValue={v[f.name] ?? ""}
        aria-invalid={e[f.name] ? true : undefined}
        aria-describedby={e[f.name] ? `${f.name}-error` : undefined}
        className={fieldClass}
      />
      {e[f.name] ? (
        <p id={`${f.name}-error`} className="mt-1 text-sm text-red-700">
          {e[f.name]}
        </p>
      ) : null}
    </div>
  );
  return (
    <form ref={formRef} action={action} className="space-y-5">
      {state?.error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-200"
        >
          {state.error}
        </p>
      ) : null}
      <input type="hidden" name="contactId" value={step.contactId} />
      <div key={state?.nonce ?? "initial"} className="space-y-5">
        <p className="break-words text-sm text-charcoal/70">
          Your email (this is how you sign in): <span className="font-semibold">{step.email}</span>
        </p>
        {input({ name: "name", label: "Your name", max: 120, autoComplete: "name" })}
        {input(
          { name: "phone", label: "Phone", max: 30, autoComplete: "tel", optional: true },
          "tel",
        )}
        <fieldset className="space-y-4">
          <legend className="font-display text-lg font-semibold text-forest">
            Billing address{step.isCompany ? ` for ${step.customerName}` : ""}
          </legend>
          <p className="text-sm text-charcoal/70">
            This address belongs to the account{step.isCompany ? ` for ${step.customerName}` : ""},
            so it is shared: anyone else with portal access to this account can see it and change
            it.
          </p>
          {BILLING.map((f) => input(f))}
        </fieldset>
        <div>
          <label className="flex min-h-11 items-start gap-3 py-1">
            <input
              type="checkbox"
              name="consent"
              required
              defaultChecked={v.consent === "on"}
              aria-invalid={e.consent ? true : undefined}
              aria-describedby={e.consent ? "consent-error" : undefined}
              className="mt-1 h-5 w-5 shrink-0 accent-forest"
            />
            <span>
              I agree that ACE Garden Services may keep these details to quote, provide and bill its
              services, and to contact me about them (POPIA).
            </span>
          </label>
          {e.consent ? (
            <p id="consent-error" className="mt-1 text-sm text-red-700">
              {e.consent}
            </p>
          ) : null}
        </div>
      </div>
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Saving..." : "Save and continue"}
      </button>
    </form>
  );
}
