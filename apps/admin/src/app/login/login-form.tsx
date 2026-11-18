"use client";

import { useActionState } from "react";
import { buttonClass, inputClass } from "@/components/auth-card";
import { signIn } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, undefined);

  return (
    <form action={action} className="space-y-5">
      <label className="block text-sm font-medium text-charcoal">
        Email
        <input
          name="email"
          type="email"
          autoComplete="username"
          // React clears the form after each attempt, so the email is put back from the result.
          defaultValue={state?.email}
          key={state?.email ?? "empty"}
          required
          autoFocus
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium text-charcoal">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </label>
      {state?.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
