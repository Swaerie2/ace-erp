"use client";

import { useActionState } from "react";
import { buttonClass, inputClass } from "@/components/auth-card";
import { verifyCode } from "../actions";

export function VerifyForm() {
  const [state, action, pending] = useActionState(verifyCode, undefined);

  return (
    <form action={action} className="space-y-5">
      <label className="block text-sm font-medium text-charcoal">
        6-digit code
        <input
          name="code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="one-time-code"
          required
          autoFocus
          className={`${inputClass} text-center font-mono text-xl tracking-[0.4em]`}
        />
      </label>
      {state?.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Checking…" : "Verify"}
      </button>
    </form>
  );
}
