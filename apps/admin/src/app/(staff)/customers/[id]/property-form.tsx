"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { buttonClass } from "@/components/auth-card";
import { FormMessage } from "@/components/form";
import { useFocusOnFeedback } from "@/lib/use-focus-on-feedback";
import { PropertyFields } from "../_components/property-fields";
import { savePropertyAction } from "../actions";

export type PropertyRow = {
  id: string;
  label: string;
  addressLine1: string;
  addressLine2: string | null;
  suburb: string | null;
  city: string | null;
  postalCode: string | null;
  mapUrl: string | null;
  accessNotes: string | null;
  lawnSizeSqm: number | null;
  grassType: string | null;
  hasIrrigation: boolean;
  terrainNotes: string | null;
  frequency: string | null;
  preferredDay: string | null;
};

function toValues(p?: PropertyRow): Record<string, string> {
  if (!p) return {};
  const v: Record<string, string> = { label: p.label, addressLine1: p.addressLine1 };
  const optional: Record<string, string | number | null> = {
    addressLine2: p.addressLine2,
    suburb: p.suburb,
    city: p.city,
    postalCode: p.postalCode,
    mapUrl: p.mapUrl,
    accessNotes: p.accessNotes,
    lawnSizeSqm: p.lawnSizeSqm,
    grassType: p.grassType,
    terrainNotes: p.terrainNotes,
    frequency: p.frequency,
    preferredDay: p.preferredDay,
  };
  for (const [key, value] of Object.entries(optional))
    if (value !== null && value !== "") v[key] = String(value);
  if (p.hasIrrigation) v.hasIrrigation = "on";
  return v;
}

export function PropertyForm({
  customerId,
  property,
}: {
  customerId: string;
  property?: PropertyRow;
}) {
  const [state, action, pending] = useActionState(savePropertyAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);

  return (
    <form
      ref={formRef}
      action={action}
      className="space-y-5 rounded-2xl bg-white/70 p-5 ring-1 ring-charcoal/10"
    >
      <input type="hidden" name="customerId" value={customerId} />
      {property ? <input type="hidden" name="propertyId" value={property.id} /> : null}
      <div key={state?.nonce ?? "initial"}>
        <PropertyFields
          values={state?.values ?? toValues(property)}
          errors={state?.fieldErrors ?? {}}
        />
      </div>
      <FormMessage error={state?.error} />
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : "Save property"}
        </button>
        <Link
          href={`/customers/${customerId}?tab=properties`}
          className="self-center text-sm text-forest hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
