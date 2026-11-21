"use client";

import { useActionState, useRef } from "react";
import { inputClass } from "@/components/auth-card";
import { dangerButtonClass, FormMessage } from "@/components/form";
import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { anonymiseCustomerAction } from "../actions";

export function OwnerTools({ id, number }: { id: string; number: string }) {
  const [state, action, pending] = useActionState(anonymiseCustomerAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);

  return (
    <section
      aria-labelledby="owner-tools-heading"
      className="space-y-4 rounded-2xl border border-red-200 bg-red-50/50 p-5"
    >
      <h2 id="owner-tools-heading" className="font-display text-lg font-semibold text-red-900">
        Owner tools
      </h2>
      <p className="text-sm text-charcoal/80">
        {/* A plain link, not next/link: a prefetch would run the export and log it. */}
        <a href={`/customers/${id}/export`} className="font-semibold text-forest underline">
          Download all data we hold
        </a>{" "}
        about this customer (JSON file).
      </p>
      <form ref={formRef} action={action} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <p id="anonymise-warning" className="text-sm text-charcoal/80">
          <strong>Anonymise</strong> permanently removes names, phone numbers, emails, addresses,
          notes and access details. The customer number and money amounts stay so old invoices still
          add up. <strong>This cannot be undone.</strong>
        </p>
        <label className="block text-sm font-medium">
          Type {number} to confirm
          <input
            name="confirm"
            autoComplete="off"
            required
            aria-describedby="anonymise-warning"
            className={inputClass}
          />
        </label>
        <FormMessage error={state?.error} />
        <button type="submit" disabled={pending} className={dangerButtonClass}>
          {pending ? "Working…" : "Anonymise this customer"}
        </button>
      </form>
    </section>
  );
}
