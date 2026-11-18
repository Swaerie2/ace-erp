import type { getCustomer } from "@ace/core";
import Link from "next/link";
import { secondaryButtonClass } from "@/components/form";
import { archiveCustomerAction, restoreCustomerAction } from "../actions";
import { EditCustomerForm } from "./edit-customer-form";

type Customer = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;

/** The edit form's starting values. Built here so only these fields reach the browser. */
function toValues(c: Customer): Record<string, string> {
  const v: Record<string, string> = {
    type: c.type,
    displayName: c.displayName,
    // An archived customer stays archived on save; the select has no archived option.
    status: c.status === "ARCHIVED" ? "ACTIVE" : c.status,
  };
  const optional = {
    companyName: c.companyName,
    registrationNumber: c.registrationNumber,
    billingLine1: c.billingLine1,
    billingLine2: c.billingLine2,
    billingSuburb: c.billingSuburb,
    billingCity: c.billingCity,
    billingPostalCode: c.billingPostalCode,
    source: c.source,
    sourceNote: c.sourceNote,
    notes: c.notes,
    consentSource: c.consentSource,
    consentNote: c.consentNote,
  };
  for (const [key, value] of Object.entries(optional)) if (value) v[key] = value;
  if (c.consentAt) v.consentGiven = "on";
  return v;
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-3">
      <dt className="text-sm text-charcoal/60">{label}</dt>
      <dd className="text-sm text-charcoal sm:col-span-2">{value || "—"}</dd>
    </div>
  );
}

export function OverviewTab({
  customer: c,
  editing,
  isOwner,
}: {
  customer: Customer;
  editing: boolean;
  isOwner: boolean;
}) {
  if (editing && !c.anonymisedAt) return <EditCustomerForm id={c.id} initialValues={toValues(c)} />;

  const billing = [
    c.billingLine1,
    c.billingLine2,
    c.billingSuburb,
    c.billingCity,
    c.billingPostalCode,
  ]
    .filter(Boolean)
    .join(", ");
  const archived = c.status === "ARCHIVED";

  return (
    <div className="space-y-8">
      <dl className="divide-y divide-charcoal/10 rounded-2xl bg-white/70 px-4 ring-1 ring-charcoal/10">
        <Row
          label="Type"
          value={c.type === "COMPANY" ? "Company / body corporate / agent" : "Homeowner / person"}
        />
        <Row label="Company" value={c.companyName} />
        <Row label="Registration number" value={c.registrationNumber} />
        <Row label="Billing address" value={billing} />
        <Row
          label="Source"
          value={[c.source?.toLowerCase(), c.sourceNote].filter(Boolean).join(" · ")}
        />
        <Row label="Internal notes" value={c.notes} />
        <Row
          label="Details held with consent"
          value={
            c.consentAt
              ? `Yes, ${c.consentAt.toLocaleDateString("en-ZA")}${c.consentSource ? ` (${c.consentSource})` : ""}`
              : "Not recorded"
          }
        />
      </dl>

      {c.anonymisedAt ? (
        <p className="text-sm text-charcoal/60">
          This customer was anonymised on {c.anonymisedAt.toLocaleDateString("en-ZA")}.
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Link href={`/customers/${c.id}?tab=overview&edit=1`} className={secondaryButtonClass}>
            Edit details
          </Link>
          <form action={archived ? restoreCustomerAction : archiveCustomerAction}>
            <input type="hidden" name="id" value={c.id} />
            <button type="submit" className={secondaryButtonClass}>
              {archived ? "Restore customer" : "Archive customer"}
            </button>
          </form>
        </div>
      )}
      {isOwner && !c.anonymisedAt ? (
        <p className="text-xs text-charcoal/50">Owner tools are added in a later step.</p>
      ) : null}
    </div>
  );
}
