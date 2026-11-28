"use client";

import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { useActionState, useRef } from "react";
import { buttonClass } from "@/components/auth-card";
import { dangerButtonClass, FormMessage, TextAreaField } from "@/components/form";
import { issueInvoiceAction, voidInvoiceAction } from "../actions";

/**
 * Issue one draft; each problem shows on its own line. `version` is the draft version on screen, so a draft
 * saved by someone else since then is refused instead of issued unseen.
 */
export function IssueForm({
  id,
  version,
  disabled,
}: {
  id: string;
  version: number;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(issueInvoiceAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      {state?.error ? (
        <p
          role="alert"
          className="whitespace-pre-line rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
        >
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending || disabled} className={buttonClass}>
        {pending ? "Issuing..." : "Issue and email"}
      </button>
    </form>
  );
}

export function VoidForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(voidInvoiceAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <FormMessage error={state?.error} />
      <div key={state?.nonce ?? "initial"}>
        <TextAreaField
          label="Why is this invoice being voided?"
          name="reason"
          rows={2}
          required
          hint="Up to 300 characters. Kept on the invoice."
          defaultValue={state?.values?.reason}
          error={state?.fieldErrors?.reason}
        />
      </div>
      <button type="submit" disabled={pending} className={dangerButtonClass}>
        {pending ? "Voiding..." : "Void this invoice"}
      </button>
    </form>
  );
}
