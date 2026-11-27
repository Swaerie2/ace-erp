"use client";

import { useActionState, useRef } from "react";
import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { buttonClass } from "@/components/auth-card";
import { FormMessage, TextField } from "@/components/form";
import { saveInvoiceSettingsAction } from "./actions";

export type SettingsValues = {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  branchCode: string;
  accountType: string;
  onceOffDueDays: string;
  lateFee: string;
};

export function SettingsForm({ initial, saved }: { initial: SettingsValues; saved: boolean }) {
  const [state, action, pending] = useActionState(saveInvoiceSettingsAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  const v = { ...initial, ...(state?.values ?? {}) };
  const e = state?.fieldErrors ?? {};
  return (
    <form ref={formRef} action={action} className="mt-6 space-y-6">
      {saved && !state ? (
        <p
          role="status"
          className="rounded-lg bg-forest/10 px-3 py-2 text-sm text-forest ring-1 ring-forest/25"
        >
          Saved. Invoices issued from now on use these details.
        </p>
      ) : null}
      <div key={state?.nonce ?? "initial"} className="space-y-6">
        <fieldset className="space-y-4 rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10">
          <legend className="px-1 font-display text-lg font-semibold text-forest">
            Bank details
          </legend>
          <TextField label="Bank" name="bankName" defaultValue={v.bankName} error={e.bankName} />
          <TextField
            label="Account holder"
            name="accountHolder"
            defaultValue={v.accountHolder}
            error={e.accountHolder}
          />
          <TextField
            label="Account number"
            name="accountNumber"
            inputMode="numeric"
            defaultValue={v.accountNumber}
            error={e.accountNumber}
          />
          <TextField
            label="Branch code"
            name="branchCode"
            inputMode="numeric"
            defaultValue={v.branchCode}
            error={e.branchCode}
          />
          <TextField
            label="Account type"
            name="accountType"
            hint="For example Business cheque."
            defaultValue={v.accountType}
            error={e.accountType}
          />
        </fieldset>
        <fieldset className="space-y-4 rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10">
          <legend className="px-1 font-display text-lg font-semibold text-forest">Defaults</legend>
          <TextField
            label="Once-off invoices are due after (days)"
            name="onceOffDueDays"
            inputMode="numeric"
            required
            hint="Counted from the day the invoice is issued. Staff can change it on each invoice."
            defaultValue={v.onceOffDueDays}
            error={e.onceOffDueDays}
          />
          <TextField
            label="Late payment fee (rand)"
            name="lateFee"
            inputMode="decimal"
            hint="Suggested on the next monthly invoice for each overdue invoice. 0 switches the suggestion off."
            defaultValue={v.lateFee}
            error={e.lateFee}
          />
        </fieldset>
      </div>
      <FormMessage error={state?.error} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Saving..." : "Save invoice settings"}
      </button>
    </form>
  );
}
