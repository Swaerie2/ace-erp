import type { getCustomer, getPropertyAgreement } from "@ace/core";
import Link from "next/link";
import { secondaryButtonClass } from "@/components/form";
import { archivePropertyAction } from "../actions";
import { AgreementPanel } from "./agreement-panel";
import { PropertyForm, type PropertyRow } from "./property-form";

type Customer = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;

/** Only these fields cross to the browser. */
function toRow(p: Customer["properties"][number]): PropertyRow {
  return {
    id: p.id,
    label: p.label,
    addressLine1: p.addressLine1,
    addressLine2: p.addressLine2,
    suburb: p.suburb,
    city: p.city,
    postalCode: p.postalCode,
    mapUrl: p.mapUrl,
    accessNotes: p.accessNotes,
    lawnSizeSqm: p.lawnSizeSqm,
    grassType: p.grassType,
    hasIrrigation: p.hasIrrigation,
    terrainNotes: p.terrainNotes,
    frequency: p.frequency,
    preferredDay: p.preferredDay,
  };
}

export function PropertiesTab({
  customer,
  edit,
  add,
  agreements,
}: {
  customer: Customer;
  edit?: string | undefined;
  add: boolean;
  agreements: Record<string, Awaited<ReturnType<typeof getPropertyAgreement>>>;
}) {
  const locked = Boolean(customer.anonymisedAt);
  const editing = locked ? undefined : customer.properties.find((p) => p.id === edit);

  if (add && !locked) return <PropertyForm customerId={customer.id} />;
  if (editing) return <PropertyForm customerId={customer.id} property={toRow(editing)} />;

  return (
    <div className="space-y-4">
      {customer.properties.length === 0 ? (
        <p className="text-charcoal/60">No properties yet.</p>
      ) : null}
      <ul className="space-y-4">
        {customer.properties.map((p) => (
          <li key={p.id} className="rounded-2xl bg-white/70 p-5 ring-1 ring-charcoal/10">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 break-words">
                <p className="font-semibold text-forest">{p.label}</p>
                <p className="text-sm text-charcoal">
                  {[p.addressLine1, p.addressLine2, p.suburb, p.city, p.postalCode]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                {p.mapUrl ? (
                  <a
                    href={p.mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-forest underline"
                  >
                    Open map<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : null}
              </div>
              {locked ? null : (
                <div className="flex gap-2">
                  <Link
                    href={`/customers/${customer.id}?tab=properties&edit=${p.id}`}
                    className={secondaryButtonClass}
                    aria-label={`Edit ${p.label}`}
                  >
                    Edit
                  </Link>
                  <form action={archivePropertyAction}>
                    <input type="hidden" name="customerId" value={customer.id} />
                    <input type="hidden" name="propertyId" value={p.id} />
                    <button
                      type="submit"
                      className={secondaryButtonClass}
                      aria-label={`Archive ${p.label}`}
                    >
                      Archive
                    </button>
                  </form>
                </div>
              )}
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div>
                <dt className="inline text-charcoal/60">Service: </dt>
                <dd className="inline">
                  {p.frequency ? p.frequency.toLowerCase().replace("_", "-") : "not set"}
                  {p.preferredDay ? `, ${p.preferredDay}` : ""}
                </dd>
              </div>
              <div>
                <dt className="inline text-charcoal/60">Lawn: </dt>
                <dd className="inline">
                  {[
                    p.lawnSizeSqm ? `${p.lawnSizeSqm} m²` : null,
                    p.grassType,
                    p.hasIrrigation ? "irrigation" : null,
                  ]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </dd>
              </div>
              {p.accessNotes ? (
                <div className="sm:col-span-2">
                  <dt className="inline text-charcoal/60">Access: </dt>
                  <dd className="inline">{p.accessNotes}</dd>
                </div>
              ) : null}
              {p.terrainNotes ? (
                <div className="sm:col-span-2">
                  <dt className="inline text-charcoal/60">Terrain: </dt>
                  <dd className="inline">{p.terrainNotes}</dd>
                </div>
              ) : null}
            </dl>
            <AgreementPanel agreement={agreements[p.id] ?? { current: null, onceOff: [] }} />
          </li>
        ))}
      </ul>
      {locked ? null : (
        <Link
          href={`/customers/${customer.id}?tab=properties&add=1`}
          className={secondaryButtonClass}
        >
          Add property
        </Link>
      )}
    </div>
  );
}
