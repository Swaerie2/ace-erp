"use client";

import { useActionState, useRef, useState } from "react";
import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { buttonClass } from "@/components/auth-card";
import { FormMessage, TextField } from "@/components/form";
import { saveCompanyAddressAction, saveCompanyLogoAction } from "./actions";

/** The same cap the server checks (core's MAX_LOGO_BYTES): checked here first so a big file is not sent. */
const MAX_LOGO_BYTES = 524288;
const TOO_BIG = "That picture is larger than 500 KB. Make it smaller and try again.";

const fileInputClass =
  "mt-1 block w-full text-sm text-charcoal file:mr-3 file:rounded-full file:border-0 file:bg-forest/10 file:px-4 file:py-2 file:font-display file:text-sm file:font-semibold file:text-forest hover:file:bg-forest/20";

export function LogoForm() {
  const [state, action, pending] = useActionState(saveCompanyLogoAction, undefined);
  const [tooBig, setTooBig] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  const error = tooBig ? TOO_BIG : state?.fieldErrors?.logo;
  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={(event) => {
        const input = event.currentTarget.elements.namedItem("logo");
        const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
        const big = Boolean(file && file.size > MAX_LOGO_BYTES);
        setTooBig(big);
        if (big) event.preventDefault();
      }}
      className="space-y-4"
    >
      <label className="block text-sm font-medium text-charcoal">
        Logo picture
        <input
          type="file"
          name="logo"
          accept="image/png,image/jpeg"
          aria-invalid={error ? true : undefined}
          aria-describedby="logo-help"
          onChange={() => setTooBig(false)}
          className={fileInputClass}
        />
        <span id="logo-help" className="mt-1 block text-xs font-normal text-charcoal/60">
          PNG or JPEG, up to 500 KB, at least 32 pixels each way. It appears on invoices, statements
          and quotes.
        </span>
        {error ? (
          <span role="alert" className="mt-1 block text-xs font-normal text-red-700">
            {error}
          </span>
        ) : null}
      </label>
      <FormMessage error={state?.error} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Uploading..." : "Upload logo"}
      </button>
    </form>
  );
}

export type AddressValues = {
  line1: string;
  line2: string;
  suburb: string;
  city: string;
  postalCode: string;
};

export function AddressForm({ initial }: { initial: AddressValues }) {
  const [state, action, pending] = useActionState(saveCompanyAddressAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  const v = { ...initial, ...(state?.values ?? {}) };
  const e = state?.fieldErrors ?? {};
  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div key={state?.nonce ?? "initial"} className="space-y-4">
        <TextField label="Address line 1" name="line1" defaultValue={v.line1} error={e.line1} />
        <TextField label="Address line 2" name="line2" defaultValue={v.line2} error={e.line2} />
        <TextField label="Suburb" name="suburb" defaultValue={v.suburb} error={e.suburb} />
        <TextField label="City" name="city" defaultValue={v.city} error={e.city} />
        <TextField
          label="Postal code"
          name="postalCode"
          defaultValue={v.postalCode}
          error={e.postalCode}
        />
      </div>
      <FormMessage error={state?.error} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Saving..." : "Save address"}
      </button>
    </form>
  );
}
