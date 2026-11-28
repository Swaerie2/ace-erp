"use client";

import { INVOICE_LINE_KIND_LABELS, MAX_INVOICE_LINES, NEW_LINE_KINDS } from "@ace/core/client";
import type { InvoiceLineKindValue } from "@ace/core";
import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { useActionState, useRef } from "react";
import { buttonClass, inputClass } from "@/components/auth-card";
import { FormMessage } from "@/components/form";
import { saveInvoiceDraftAction } from "../actions";

export type DraftLine = {
  id: string;
  kind: InvoiceLineKindValue;
  description: string;
  amount: string;
};

const EMPTY_ROWS = 3;

function FieldError({ message }: { message: string | undefined }) {
  return message ? (
    <span role="alert" className="mt-1 block text-xs font-normal text-red-700">
      {message}
    </span>
  ) : null;
}

/** The whole draft in one form: due date, every line, three empty rows for new lines. */
export function DraftForm({
  id,
  version,
  monthly,
  dueDate,
  lines,
}: {
  id: string;
  version: number;
  monthly: boolean;
  dueDate: string;
  lines: DraftLine[];
}) {
  const [state, action, pending] = useActionState(saveInvoiceDraftAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  const typed = state?.values;
  const e = state?.fieldErrors ?? {};
  const val = (name: string, fallback: string) => (typed ? (typed[name] ?? "") : fallback);
  const empty = Math.max(0, Math.min(EMPTY_ROWS, MAX_INVOICE_LINES - lines.length));
  const rows = [
    ...lines.map((l) => ({ ...l, existing: true })),
    ...Array.from({ length: empty }, () => ({
      id: "",
      kind: "SERVICE" as InvoiceLineKindValue,
      description: "",
      amount: "",
      existing: false,
    })),
  ];
  return (
    <form ref={formRef} action={action} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <FormMessage error={state?.error} />
      <div key={state?.nonce ?? "initial"} className="space-y-4">
        <label className="block text-sm font-medium text-charcoal">
          Due date
          <input
            type="date"
            name="dueDate"
            required={monthly}
            defaultValue={val("dueDate", dueDate)}
            aria-invalid={e.dueDate ? true : undefined}
            className={`${inputClass} min-h-10`}
          />
          <span className="mt-1 block text-xs font-normal text-charcoal/60">
            {monthly
              ? "Set by the run from the customer's billing timing. Change it if needed."
              : "Leave empty to use the default from Invoice settings, counted from the day it is issued."}
          </span>
          <FieldError message={e.dueDate} />
        </label>
        <ol className="space-y-3">
          {rows.map((r, i) => {
            const p = `line-${i}-`;
            return (
              <li key={i} className="space-y-2 rounded-2xl bg-white/70 p-3 ring-1 ring-charcoal/10">
                {r.existing ? (
                  <>
                    <input type="hidden" name={`${p}id`} value={r.id} />
                    <input type="hidden" name={`${p}kind`} value={r.kind} />
                    <p className="text-xs font-semibold text-charcoal/60">
                      Line {i + 1}: {INVOICE_LINE_KIND_LABELS[r.kind]}
                    </p>
                  </>
                ) : (
                  <label className="block text-sm font-medium text-charcoal">
                    New line
                    <select
                      name={`${p}kind`}
                      defaultValue={val(`${p}kind`, "SERVICE")}
                      aria-invalid={e[`${p}kind`] ? true : undefined}
                      className={`${inputClass} min-h-10`}
                    >
                      {NEW_LINE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {INVOICE_LINE_KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                    <FieldError message={e[`${p}kind`]} />
                  </label>
                )}
                <label className="block text-sm font-medium text-charcoal">
                  Description
                  <input
                    name={`${p}description`}
                    maxLength={300}
                    defaultValue={val(`${p}description`, r.description)}
                    aria-invalid={e[`${p}description`] ? true : undefined}
                    className={`${inputClass} min-h-10`}
                  />
                  <FieldError message={e[`${p}description`]} />
                </label>
                <label className="block text-sm font-medium text-charcoal">
                  Amount (rand)
                  <input
                    name={`${p}amount`}
                    inputMode="decimal"
                    defaultValue={val(`${p}amount`, r.amount)}
                    aria-invalid={e[`${p}amount`] ? true : undefined}
                    className={`${inputClass} min-h-10`}
                  />
                  {!r.existing ? (
                    <span className="mt-1 block text-xs font-normal text-charcoal/60">
                      Only an adjustment can be negative, for example -100.
                    </span>
                  ) : null}
                  <FieldError message={e[`${p}amount`]} />
                </label>
                {r.existing ? (
                  <label className="flex min-h-10 items-center gap-3 text-sm text-charcoal">
                    <input
                      type="checkbox"
                      name={`${p}remove`}
                      defaultChecked={val(`${p}remove`, "") === "on"}
                      className="h-5 w-5 rounded border-charcoal/30"
                    />
                    Remove this line
                  </label>
                ) : null}
              </li>
            );
          })}
        </ol>
        <p className="text-xs text-charcoal/60">
          {empty === 0
            ? "This invoice has the most lines allowed."
            : "Need more lines? Save, and three new empty lines appear."}
        </p>
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Saving..." : "Save draft"}
      </button>
    </form>
  );
}
