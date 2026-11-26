"use client";

import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { useActionState, useRef } from "react";
import { fieldClass, primaryButtonClass } from "@/components/form-classes";
import { verifyCodeAction } from "../actions";

export function CodeForm() {
  const [state, action, pending] = useActionState(verifyCodeAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  return (
    <form ref={formRef} action={action} className="space-y-4">
      {state?.error ? (
        <p
          id="code-error"
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-200"
        >
          {state.error}
        </p>
      ) : null}
      {/* Remounted on every answer, so a refused code is cleared and the field is ready for a new one. */}
      <div key={state?.nonce ?? "initial"}>
        <label htmlFor="code" className="font-semibold text-charcoal">
          6-digit code
        </label>
        <input
          id="code"
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          aria-invalid={state?.error ? true : undefined}
          aria-describedby={state?.error ? "code-error" : undefined}
          className={`${fieldClass} tracking-[0.3em]`}
        />
      </div>
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Checking..." : "Sign in"}
      </button>
    </form>
  );
}
