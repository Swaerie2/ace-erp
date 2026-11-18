"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { buttonClass } from "@/components/auth-card";
import { FormMessage } from "@/components/form";
import { useFocusOnFeedback } from "@/lib/use-focus-on-feedback";
import { updateCustomerAction } from "../actions";
import { CustomerFields } from "../_components/customer-fields";

export function EditCustomerForm({
  id,
  initialValues,
}: {
  id: string;
  initialValues: Record<string, string>;
}) {
  const [state, action, pending] = useActionState(updateCustomerAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);

  return (
    <form ref={formRef} action={action} className="space-y-6">
      <input type="hidden" name="id" value={id} />
      <div key={state?.nonce ?? "initial"}>
        <CustomerFields values={state?.values ?? initialValues} errors={state?.fieldErrors ?? {}} />
      </div>
      <FormMessage error={state?.error} />
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : "Save changes"}
        </button>
        <Link href={`/customers/${id}`} className="self-center text-sm text-forest hover:underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}
