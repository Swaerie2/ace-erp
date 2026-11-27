"use client";

import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { useActionState, useRef } from "react";
import { fieldClass } from "@/components/form-classes";
import type { FormAction } from "./accept-form";

/** The decline form, shared by the private link page and the portal quote page. */
export function DeclineForm({ action: submit }: { action: FormAction }) {
  const [state, action, pending] = useActionState(submit, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  return (
    <details
      className="rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10"
      open={state?.error || state?.fieldErrors ? true : undefined}
    >
      <summary className="min-h-11 cursor-pointer py-2 font-semibold text-charcoal">
        Not for you? Decline this quotation
      </summary>
      <form ref={formRef} action={action} className="mt-3 space-y-4">
        {state?.error ? (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-200"
          >
            {state.error}
          </p>
        ) : null}
        <div key={state?.nonce ?? "initial"}>
          <label htmlFor="reason" className="font-semibold text-charcoal">
            Reason (optional)
          </label>
          <textarea
            id="reason"
            name="reason"
            rows={3}
            maxLength={500}
            defaultValue={state?.values?.reason ?? ""}
            aria-invalid={state?.fieldErrors?.reason ? true : undefined}
            aria-describedby={state?.fieldErrors?.reason ? "reason-error" : undefined}
            className={fieldClass}
          />
          {state?.fieldErrors?.reason ? (
            <p id="reason-error" className="mt-1 text-sm text-red-700">
              {state.fieldErrors.reason}
            </p>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-full px-6 py-2.5 font-display text-sm font-semibold text-red-800 ring-1 ring-red-300 hover:bg-red-50 disabled:opacity-60"
        >
          {pending ? "Saving..." : "Decline quotation"}
        </button>
      </form>
    </details>
  );
}
