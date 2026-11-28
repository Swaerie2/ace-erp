"use client";

import {
  formatCentsForInput,
  formatZAR,
  parseRandToCents,
  suggestAllocations,
} from "@ace/core/client";
import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { useActionState, useRef, useState } from "react";
import { buttonClass, inputClass } from "@/components/auth-card";
import { FormMessage, secondaryButtonClass } from "@/components/form";
import { recordPaymentAction } from "../actions";

export type OpenRow = {
  id: string;
  reference: string;
  forName: string | null;
  dueDate: string;
  dueLabel: string;
  balanceCents: number;
};

export type PaymentInitial = {
  receivedOn: string;
  amount: string;
  reference: string;
  allocations: Record<string, string>;
};

function FieldError({ message }: { message: string | undefined }) {
  return message ? (
    <span role="alert" className="mt-1 block text-xs font-normal text-red-700">
      {message}
    </span>
  ) : null;
}

/**
 * The record-payment form. The allocation boxes start from `initial` (the invoice the staff came from, or the
 * reported invoice); "Fill oldest first" spreads the amount over the open invoices, oldest due first. The
 * totals shown here are only a guide: the server parses every box again and core re-checks after locking.
 */
export function PaymentForm({
  payerId,
  reportId,
  open,
  initial,
  today,
}: {
  payerId: string;
  reportId: string | null;
  open: OpenRow[];
  initial: PaymentInitial;
  today: string;
}) {
  const [state, action, pending] = useActionState(recordPaymentAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  const [amount, setAmount] = useState(initial.amount);
  const [alloc, setAlloc] = useState<Record<string, string>>(initial.allocations);
  const e = state?.fieldErrors ?? {};
  const typed = state?.values;
  const amountCents = parseRandToCents(amount) ?? 0;
  const allocatedCents = Object.values(alloc).reduce((t, v) => t + (parseRandToCents(v) ?? 0), 0);
  const left = amountCents - allocatedCents;

  const fillOldest = () => {
    const next: Record<string, string> = {};
    for (const a of suggestAllocations(
      amountCents,
      open.map((o) => ({
        id: o.id,
        balanceCents: o.balanceCents,
        dueDate: o.dueDate,
        reference: o.reference,
      })),
    )) {
      next[a.invoiceId] = formatCentsForInput(a.amountCents);
    }
    setAlloc(next);
  };

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <FormMessage error={state?.error} />
      <input type="hidden" name="payerCustomerId" value={payerId} />
      <input type="hidden" name="reportId" value={reportId ?? ""} />
      <div key={state?.nonce ?? "initial"} className="space-y-4">
        <label className="block text-sm font-medium text-charcoal">
          Date the money arrived
          <input
            type="date"
            name="receivedOn"
            required
            max={today}
            defaultValue={typed?.receivedOn ?? initial.receivedOn}
            aria-invalid={e.receivedOn ? true : undefined}
            className={`${inputClass} min-h-10`}
          />
          <FieldError message={e.receivedOn} />
        </label>
        <label className="block text-sm font-medium text-charcoal">
          Bank reference (optional)
          <input
            name="reference"
            maxLength={100}
            autoComplete="off"
            defaultValue={typed?.reference ?? initial.reference}
            aria-invalid={e.reference ? true : undefined}
            className={`${inputClass} min-h-10`}
          />
          <FieldError message={e.reference} />
        </label>
        <label className="block text-sm font-medium text-charcoal">
          Note (optional)
          <textarea
            name="note"
            rows={2}
            maxLength={500}
            defaultValue={typed?.note ?? ""}
            aria-invalid={e.note ? true : undefined}
            className={inputClass}
          />
          <span className="mt-1 block text-xs font-normal text-charcoal/60">
            For ACE only. Up to 500 characters.
          </span>
          <FieldError message={e.note} />
        </label>
      </div>
      <label className="block text-sm font-medium text-charcoal">
        Amount received (rand)
        <input
          name="amount"
          inputMode="decimal"
          required
          autoComplete="off"
          placeholder="For example 1150.00"
          value={amount}
          onChange={(ev) => setAmount(ev.target.value)}
          aria-invalid={e.amount ? true : undefined}
          className={`${inputClass} min-h-10`}
        />
        <FieldError message={e.amount} />
      </label>
      <fieldset className="min-w-0 space-y-3 rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10">
        <legend className="px-1 font-display text-base font-semibold text-forest">
          Allocate to invoices
        </legend>
        {open.length === 0 ? (
          <p className="text-sm text-charcoal/60">
            Nothing is owed: the whole payment becomes credit on account.
          </p>
        ) : (
          <>
            <p className="text-sm text-charcoal/70">
              Leave a box empty to allocate nothing to that invoice. Whatever is not allocated stays
              as credit on account.
            </p>
            <button
              type="button"
              onClick={fillOldest}
              disabled={amountCents <= 0}
              className={`${secondaryButtonClass} min-h-10 disabled:opacity-60`}
            >
              Fill oldest first
            </button>
            {open.map((o) => (
              <label key={o.id} className="block break-words text-sm font-medium text-charcoal">
                {o.reference}
                {o.forName ? `, ${o.forName}` : ""}: {formatZAR(o.balanceCents)} owed
                {o.dueLabel ? `, due ${o.dueLabel}` : ""}
                <input
                  name={`alloc-${o.id}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={alloc[o.id] ?? ""}
                  onChange={(ev) => setAlloc({ ...alloc, [o.id]: ev.target.value })}
                  aria-invalid={e[`alloc-${o.id}`] ? true : undefined}
                  className={`${inputClass} min-h-10`}
                />
                <FieldError message={e[`alloc-${o.id}`]} />
              </label>
            ))}
          </>
        )}
        <p className="text-sm text-charcoal/70" aria-live="polite">
          Allocated {formatZAR(allocatedCents)} of {formatZAR(amountCents)}.
          {left > 0 ? ` ${formatZAR(left)} stays as credit on account.` : ""}
          {left < 0 ? " That is more than the payment." : ""}
        </p>
      </fieldset>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Recording..." : "Record payment"}
      </button>
    </form>
  );
}
