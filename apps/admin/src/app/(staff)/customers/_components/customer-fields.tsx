import { CUSTOMER_SOURCES } from "@ace/core/client";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/form";

type Props = { values: Record<string, string>; errors: Record<string, string>; editing?: boolean };

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function CustomerFields({ values: v, errors: e, editing }: Props) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Type"
          name="type"
          defaultValue={v.type ?? "PERSON"}
          options={[
            { value: "PERSON", label: "Homeowner / person" },
            { value: "COMPANY", label: "Company, body corporate or agent" },
          ]}
          error={e.type}
        />
        <SelectField
          label="Status"
          name="status"
          defaultValue={v.status ?? "ACTIVE"}
          options={[
            { value: "LEAD", label: "Lead" },
            { value: "ACTIVE", label: "Active" },
            { value: "PAUSED", label: "Paused" },
          ]}
          error={e.status}
        />
      </div>
      <TextField
        label="Name"
        name="displayName"
        required
        defaultValue={v.displayName}
        error={e.displayName}
        autoFocus={!editing}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Company name"
          name="companyName"
          defaultValue={v.companyName}
          error={e.companyName}
        />
        <TextField
          label="Registration number"
          name="registrationNumber"
          defaultValue={v.registrationNumber}
          error={e.registrationNumber}
        />
      </div>

      <fieldset className="space-y-4">
        <legend className="font-display text-sm font-semibold text-forest">Billing address</legend>
        <TextField
          label="Street address"
          name="billingLine1"
          defaultValue={v.billingLine1}
          error={e.billingLine1}
        />
        <TextField
          label="Address line 2"
          name="billingLine2"
          defaultValue={v.billingLine2}
          error={e.billingLine2}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Suburb"
            name="billingSuburb"
            defaultValue={v.billingSuburb}
            error={e.billingSuburb}
          />
          <TextField
            label="City"
            name="billingCity"
            defaultValue={v.billingCity}
            error={e.billingCity}
          />
          <TextField
            label="Postal code"
            name="billingPostalCode"
            inputMode="numeric"
            defaultValue={v.billingPostalCode}
            error={e.billingPostalCode}
          />
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Where did they find us?"
          name="source"
          defaultValue={v.source ?? ""}
          options={[
            { value: "", label: "Not recorded" },
            ...CUSTOMER_SOURCES.map((s) => ({ value: s, label: label(s) })),
          ]}
          error={e.source}
        />
        <TextField
          label="Source note"
          name="sourceNote"
          defaultValue={v.sourceNote}
          error={e.sourceNote}
          hint="e.g. who referred them"
        />
      </div>
      <TextAreaField
        label="Internal notes"
        name="notes"
        defaultValue={v.notes}
        error={e.notes}
        hint="Only staff managers see this."
      />

      <fieldset className="space-y-3 rounded-xl bg-cream/60 p-4">
        <legend className="px-1 font-display text-sm font-semibold text-forest">
          Privacy (POPIA)
        </legend>
        <CheckboxField
          label="They agreed that we may keep their details"
          name="consentGiven"
          defaultChecked={v.consentGiven === "on"}
          hint="Tick when they have said yes, in person, by message or by accepting a quote."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="How they agreed"
            name="consentSource"
            defaultValue={v.consentSource}
            error={e.consentSource}
            hint="e.g. WhatsApp, in person"
          />
          <TextField
            label="Consent note"
            name="consentNote"
            defaultValue={v.consentNote}
            error={e.consentNote}
          />
        </div>
      </fieldset>
    </div>
  );
}
