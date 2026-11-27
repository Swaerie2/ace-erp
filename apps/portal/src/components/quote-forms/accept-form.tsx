"use client";

import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { useActionState, useRef } from "react";
import { fieldClass, primaryButtonClass } from "@/components/form-classes";
import type { FormState } from "@/lib/form-state";

/** A server action already bound to its quote (by link code or by id). */
export type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>;

type Props = {
  action: FormAction;
  reference: string;
  optionalLines: { id: string; label: string }[];
  /** Today in South African time, as YYYY-MM-DD: the earliest start date. */
  today: string;
};

/** The accept form, shared by the private link page and the portal quote page. */
export function AcceptForm({ action: submit, reference, optionalLines, today }: Props) {
  const [state, action, pending] = useActionState(submit, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  const e = state?.fieldErrors ?? {};
  const v = state?.values ?? {};
  const chosen = new Set((v.chosen ?? "").split(",").filter(Boolean));
  return (
    <form
      ref={formRef}
      action={action}
      className="space-y-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-charcoal/10 sm:p-8"
    >
      {state?.error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-200"
        >
          {state.error}
        </p>
      ) : null}
      <h2 className="font-display text-xl font-semibold text-forest">Accept this quotation</h2>
      <div key={state?.nonce ?? "initial"} className="space-y-5">
        {optionalLines.length > 0 ? (
          <fieldset>
            <legend className="font-semibold text-charcoal">
              Optional add-ons (tick any you would like)
            </legend>
            <div className="mt-2 space-y-1">
              {optionalLines.map((line) => (
                <label key={line.id} className="flex min-h-11 items-center gap-3 py-1">
                  <input
                    type="checkbox"
                    name="chosen"
                    value={line.id}
                    defaultChecked={chosen.has(line.id)}
                    className="h-5 w-5 accent-forest"
                  />
                  <span>{line.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <div>
          <label htmlFor="acceptedBy" className="font-semibold text-charcoal">
            Your full name
          </label>
          <input
            id="acceptedBy"
            name="acceptedBy"
            required
            maxLength={120}
            autoComplete="name"
            defaultValue={v.acceptedBy ?? ""}
            aria-invalid={e.acceptedBy ? true : undefined}
            aria-describedby={e.acceptedBy ? "acceptedBy-error" : undefined}
            className={fieldClass}
          />
          {e.acceptedBy ? (
            <p id="acceptedBy-error" className="mt-1 text-sm text-red-700">
              {e.acceptedBy}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="startDate" className="font-semibold text-charcoal">
            Service start date
          </label>
          <p className="text-sm text-charcoal/60">Today or a later date.</p>
          <input
            id="startDate"
            name="startDate"
            type="date"
            required
            min={today}
            defaultValue={v.startDate ?? ""}
            aria-invalid={e.startDate ? true : undefined}
            aria-describedby={e.startDate ? "startDate-error" : undefined}
            className={fieldClass}
          />
          {e.startDate ? (
            <p id="startDate-error" className="mt-1 text-sm text-red-700">
              {e.startDate}
            </p>
          ) : null}
        </div>

        <div>
          <label className="flex min-h-11 items-start gap-3 py-1">
            <input
              type="checkbox"
              name="agree"
              required
              defaultChecked={v.agree === "on"}
              aria-invalid={e.agree ? true : undefined}
              aria-describedby={e.agree ? "agree-error" : undefined}
              className="mt-1 h-5 w-5 shrink-0 accent-forest"
            />
            <span>I accept this quotation (Ref {reference}) and the terms above.</span>
          </label>
          {e.agree ? (
            <p id="agree-error" className="mt-1 text-sm text-red-700">
              {e.agree}
            </p>
          ) : null}
        </div>
      </div>

      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Saving..." : "Accept this quotation"}
      </button>
    </form>
  );
}
