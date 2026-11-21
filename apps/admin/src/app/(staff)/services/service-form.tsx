"use client";

import { SERVICE_KIND_LABELS, SERVICE_KINDS } from "@ace/core/client";
import Link from "next/link";
import { useActionState, useRef } from "react";
import { buttonClass } from "@/components/auth-card";
import { FormMessage, SelectField, TextAreaField, TextField } from "@/components/form";
import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { saveServiceAction } from "./actions";

export type ServiceRow = {
  id: string;
  name: string;
  description: string;
  kind: string;
  archived: boolean;
};

const KIND_OPTIONS = SERVICE_KINDS.map((kind) => ({
  value: kind,
  label: SERVICE_KIND_LABELS[kind],
}));

/** Add (no `service`) or edit (with `service`). */
export function ServiceForm({ service }: { service?: ServiceRow }) {
  const [state, action, pending] = useActionState(saveServiceAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);

  const values: Record<string, string> = state?.values ?? {
    name: service?.name ?? "",
    description: service?.description ?? "",
    kind: service?.kind ?? "CORE",
  };
  const errors = state?.fieldErrors ?? {};

  return (
    <form ref={formRef} action={action} className="mt-6 max-w-2xl space-y-6">
      {service ? <input type="hidden" name="serviceId" value={service.id} /> : null}
      {service?.archived ? <input type="hidden" name="fromArchived" value="1" /> : null}
      <div key={state?.nonce ?? "initial"} className="space-y-4">
        <TextField
          label="Name"
          name="name"
          required
          defaultValue={values.name}
          error={errors.name}
          autoFocus={state === undefined}
        />
        <TextAreaField
          label="Description"
          name="description"
          required
          defaultValue={values.description}
          error={errors.description}
          rows={6}
          hint="One line per bullet point. Clients read this on a quote, so keep it plain."
        />
        <SelectField
          label="Type"
          name="kind"
          options={KIND_OPTIONS}
          defaultValue={values.kind}
          error={errors.kind}
          hint="An optional extra is offered on top of other services, such as weed treatment."
        />
      </div>
      <FormMessage error={state?.error} />
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : service ? "Save changes" : "Add service"}
        </button>
        <Link
          href={service?.archived ? "/services?archived=1" : "/services"}
          className="inline-flex min-h-10 items-center text-sm text-forest hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
