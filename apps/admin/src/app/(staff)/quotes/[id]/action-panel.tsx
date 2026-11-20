"use client";

import {
  ACCEPT_METHOD_LABELS,
  SENT_METHOD_LABELS,
  SENT_METHODS,
  STAFF_ACCEPT_METHODS,
} from "@ace/core/client";
import type { QuoteDisplayStatus } from "@ace/core";
import { useActionState } from "react";
import { buttonClass, inputClass } from "@/components/auth-card";
import {
  FormMessage,
  SelectField,
  TextAreaField,
  TextField,
  secondaryButtonClass,
} from "@/components/form";
import {
  acceptQuoteAction,
  declineQuoteAction,
  markSentAction,
  reverseAcceptanceAction,
  reviseQuoteAction,
  withdrawQuoteAction,
} from "../actions";

type Props = {
  id: string;
  status: QuoteDisplayStatus;
  isOwner: boolean;
  recipientName: string;
  optionalLines: { id: string; label: string }[];
  today: string;
};

const SENT_OPTIONS = SENT_METHODS.map((m) => ({ value: m, label: SENT_METHOD_LABELS[m] }));
const ACCEPT_OPTIONS = STAFF_ACCEPT_METHODS.map((m) => ({
  value: m,
  label: ACCEPT_METHOD_LABELS[m],
}));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10">
      <summary className="min-h-10 cursor-pointer py-2 font-display text-base font-semibold text-forest">
        {title}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function AcceptForm({ id, recipientName, optionalLines, today }: Props) {
  const [state, action, pending] = useActionState(acceptQuoteAction, undefined);
  const v = state?.values ?? { method: "WHATSAPP", acceptedBy: recipientName };
  const e = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <div key={state?.nonce ?? "initial"} className="space-y-4">
        <SelectField
          label="How did they accept?"
          name="method"
          options={ACCEPT_OPTIONS}
          defaultValue={v.method}
          error={e.method}
        />
        <TextField
          label="Accepted by"
          name="acceptedBy"
          required
          defaultValue={v.acceptedBy}
          error={e.acceptedBy}
        />
        <label className="block text-sm font-medium text-charcoal">
          Service start date
          <input
            type="date"
            name="startDate"
            min={today}
            defaultValue={v.startDate}
            className={inputClass}
            aria-invalid={e.startDate ? true : undefined}
          />
          {e.startDate ? (
            <span role="alert" className="mt-1 block text-xs font-normal text-red-700">
              {e.startDate}
            </span>
          ) : null}
        </label>
        {optionalLines.length > 0 ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-charcoal">
              Optional add-ons they chose
            </legend>
            {optionalLines.map((l) => (
              <label key={l.id} className="flex min-h-10 items-center gap-3 text-sm text-charcoal">
                <input
                  type="checkbox"
                  name="chosen"
                  value={l.id}
                  className="h-5 w-5 rounded border-charcoal/30 text-forest"
                />
                {l.label}
              </label>
            ))}
          </fieldset>
        ) : null}
        <TextAreaField
          label="Note (optional)"
          name="note"
          rows={2}
          defaultValue={v.note}
          error={e.note}
        />
      </div>
      <FormMessage error={state?.error} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Recording…" : "Record acceptance"}
      </button>
    </form>
  );
}

function DeclineForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(declineQuoteAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <div key={state?.nonce ?? "initial"}>
        <TextAreaField
          label="Reason (optional)"
          name="reason"
          rows={2}
          defaultValue={state?.values?.reason}
          error={state?.fieldErrors?.reason}
        />
      </div>
      <FormMessage error={state?.error} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Recording…" : "Record decline"}
      </button>
    </form>
  );
}

function ReverseForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(reverseAcceptanceAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-charcoal/70">
        This puts the quote back to Issued and clears who accepted it. The customer&apos;s status is
        not changed.
      </p>
      <div key={state?.nonce ?? "initial"}>
        <TextAreaField
          label="Why is this being reversed?"
          name="note"
          rows={2}
          required
          defaultValue={state?.values?.note}
        />
      </div>
      <FormMessage error={state?.error} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Reversing…" : "Reverse acceptance"}
      </button>
    </form>
  );
}

export function ActionPanel(props: Props) {
  const { id, status, isOwner } = props;
  const canRevise =
    status === "ISSUED" || status === "EXPIRED" || status === "ACCEPTED" || status === "DECLINED";
  return (
    <div className="space-y-3">
      <a
        href={`/quotes/${id}/pdf`}
        target="_blank"
        rel="noopener noreferrer"
        className={secondaryButtonClass}
      >
        Download PDF<span className="sr-only"> (opens in a new tab)</span>
      </a>

      {status === "ISSUED" ? (
        <>
          <Section title="Mark as sent">
            <form action={markSentAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={id} />
              <label className="block text-sm font-medium text-charcoal">
                How did you send it?
                <select name="method" defaultValue="WHATSAPP" className={inputClass}>
                  {SENT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={secondaryButtonClass}>
                Mark as sent
              </button>
            </form>
          </Section>
          <Section title="Record acceptance">
            <AcceptForm {...props} />
          </Section>
          <Section title="Record decline">
            <DeclineForm id={id} />
          </Section>
        </>
      ) : null}

      {status === "ACCEPTED" && isOwner ? (
        <Section title="Reverse acceptance (owner)">
          <ReverseForm id={id} />
        </Section>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {canRevise ? (
          <form action={reviseQuoteAction}>
            <input type="hidden" name="id" value={id} />
            <button type="submit" className={secondaryButtonClass}>
              Revise this quote
            </button>
          </form>
        ) : null}
        {status === "ISSUED" ? (
          <form
            action={withdrawQuoteAction}
            onSubmit={(e) => {
              if (!window.confirm("Withdraw this quote? The client can no longer accept it.")) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="id" value={id} />
            <button
              type="submit"
              className="min-h-10 px-2 text-sm font-semibold text-red-700 underline"
            >
              Withdraw
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
