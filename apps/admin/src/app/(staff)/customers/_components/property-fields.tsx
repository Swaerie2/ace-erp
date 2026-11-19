import { SERVICE_FREQUENCIES, WEEKDAYS } from "@ace/core/client";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/form";

type Props = { values: Record<string, string>; errors: Record<string, string>; prefix?: string };

const freq: Record<string, string> = {
  WEEKLY: "Weekly",
  FORTNIGHTLY: "Fortnightly",
  MONTHLY: "Monthly",
  ONCE_OFF: "Once-off",
};

export function PropertyFields({ values: v, errors: e, prefix = "" }: Props) {
  const n = (name: string) => `${prefix}${name}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Label"
          name={n("label")}
          defaultValue={v[n("label")] ?? "Main property"}
          error={e[n("label")]}
        />
        <TextField
          label="Map link"
          name={n("mapUrl")}
          type="url"
          inputMode="url"
          defaultValue={v[n("mapUrl")]}
          error={e[n("mapUrl")]}
          hint="A Google Maps link"
        />
      </div>
      <TextField
        label="Street address"
        name={n("addressLine1")}
        defaultValue={v[n("addressLine1")]}
        error={e[n("addressLine1")]}
      />
      <TextField
        label="Address line 2"
        name={n("addressLine2")}
        defaultValue={v[n("addressLine2")]}
        error={e[n("addressLine2")]}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="Suburb"
          name={n("suburb")}
          defaultValue={v[n("suburb")]}
          error={e[n("suburb")]}
        />
        <TextField label="City" name={n("city")} defaultValue={v[n("city")]} error={e[n("city")]} />
        <TextField
          label="Postal code"
          name={n("postalCode")}
          inputMode="numeric"
          defaultValue={v[n("postalCode")]}
          error={e[n("postalCode")]}
        />
      </div>
      <TextAreaField
        label="Access notes"
        name={n("accessNotes")}
        defaultValue={v[n("accessNotes")]}
        error={e[n("accessNotes")]}
        hint="Gate code, dogs, who to call. Staff only."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="Lawn size (m²)"
          name={n("lawnSizeSqm")}
          inputMode="numeric"
          defaultValue={v[n("lawnSizeSqm")]}
          error={e[n("lawnSizeSqm")]}
        />
        <TextField
          label="Grass type"
          name={n("grassType")}
          defaultValue={v[n("grassType")]}
          error={e[n("grassType")]}
        />
        <div className="pt-6">
          <CheckboxField
            label="Has irrigation"
            name={n("hasIrrigation")}
            defaultChecked={v[n("hasIrrigation")] === "on"}
          />
        </div>
      </div>
      <TextAreaField
        label="Terrain notes"
        name={n("terrainNotes")}
        defaultValue={v[n("terrainNotes")]}
        error={e[n("terrainNotes")]}
        hint="Slopes, hedges, difficult areas"
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          label="Service"
          name={n("frequency")}
          defaultValue={v[n("frequency")] ?? ""}
          options={[
            { value: "", label: "Not set" },
            ...SERVICE_FREQUENCIES.map((f) => ({ value: f, label: freq[f] ?? f })),
          ]}
          error={e[n("frequency")]}
        />
        <SelectField
          label="Preferred day"
          name={n("preferredDay")}
          defaultValue={v[n("preferredDay")] ?? ""}
          options={[
            { value: "", label: "No preference" },
            ...WEEKDAYS.map((d) => ({ value: d, label: d })),
          ]}
          error={e[n("preferredDay")]}
        />
        <TextField
          label="Agreed monthly fee (R)"
          name={n("monthlyFee")}
          inputMode="decimal"
          defaultValue={v[n("monthlyFee")]}
          error={e[n("monthlyFee")]}
          hint="e.g. 850 or 850.50"
        />
      </div>
      <TextField
        label="Optional extras"
        name={n("extrasNote")}
        defaultValue={v[n("extrasNote")]}
        error={e[n("extrasNote")]}
        hint="e.g. weed treatment"
      />
    </div>
  );
}
