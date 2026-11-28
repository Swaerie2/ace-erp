"use client";

import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { useActionState, useRef } from "react";
import { inputClass } from "@/components/auth-card";
import {
  dangerButtonClass,
  FormMessage,
  secondaryButtonClass,
  TextAreaField,
} from "@/components/form";
import { allocateAction, voidPaymentAction } from "../actions";

export type AllocateOption = { id: string; label: string };

/** "Allocate the rest": one invoice and an amount. What was chosen and typed stays after an error. */
export function AllocateForm({
  paymentId,
  options,
}: {
  paymentId: string;
  options: AllocateOption[];
}) {
  const [state, action, pending] = useActionState(allocateAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  const error = state?.fieldErrors?.amount;
  return (
    <form ref={formRef} action={action} className="space-y-3">
      <FormMessage error={state?.error} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <div key={state?.nonce ?? "initial"} className="space-y-3">
        <label className="block text-sm font-medium text-charcoal">
          Invoice
          <select
            name="invoiceId"
            required
            defaultValue={state?.values?.invoiceId ?? options[0]?.id}
            className={`${inputClass} min-h-10`}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-charcoal">
          Amount (rand)
          <input
            name="amount"
            inputMode="decimal"
            required
            autoComplete="off"
            placeholder="For example 1150.00"
            defaultValue={state?.values?.amount ?? ""}
            aria-invalid={error ? true : undefined}
            className={`${inputClass} min-h-10`}
          />
          {error ? (
            <span role="alert" className="mt-1 block text-xs font-normal text-red-700">
              {error}
            </span>
          ) : null}
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        className={`${secondaryButtonClass} min-h-10 disabled:cursor-wait disabled:opacity-60`}
      >
        {pending ? "Allocating..." : "Allocate"}
      </button>
    </form>
  );
}

/** "Void the payment" with its reason (core's reason rules: required, 300 characters, no special characters). */
export function VoidPaymentForm({ paymentId }: { paymentId: string }) {
  const [state, action, pending] = useActionState(voidPaymentAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  return (
    <form ref={formRef} action={action} className="mt-3 space-y-3">
      <FormMessage error={state?.error} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <p className="text-sm text-charcoal/70">
        For example a bounced EFT or a payment recorded by mistake. The invoices it paid owe the
        money again. This cannot be undone.
      </p>
      <div key={state?.nonce ?? "initial"}>
        <TextAreaField
          label="Why is this payment being voided?"
          name="reason"
          rows={2}
          required
          hint="Up to 300 characters. Kept on the payment."
          defaultValue={state?.values?.reason}
          error={state?.fieldErrors?.reason}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className={`${dangerButtonClass} min-h-10 disabled:cursor-wait`}
      >
        {pending ? "Voiding..." : "Void the payment"}
      </button>
    </form>
  );
}
