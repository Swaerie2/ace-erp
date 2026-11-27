"use client";

import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { useActionState, useRef } from "react";
import { fieldClass, primaryButtonClass } from "@/components/form-classes";
import { requestCodeAction } from "./actions";

export function SignInForm() {
  const [state, action, pending] = useActionState(requestCodeAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  const error = state?.fieldErrors?.email;
  return (
    <form ref={formRef} action={action} className="space-y-4">
      {state?.error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-200"
        >
          {state.error}
        </p>
      ) : null}
      <div key={state?.nonce ?? "initial"}>
        <label htmlFor="email" className="font-semibold text-charcoal">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          inputMode="email"
          defaultValue={state?.values?.email ?? ""}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "email-error" : undefined}
          className={fieldClass}
        />
        {error ? (
          <p id="email-error" className="mt-1 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Sending..." : "Email me a code"}
      </button>
    </form>
  );
}
