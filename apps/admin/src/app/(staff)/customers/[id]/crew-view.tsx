import { formatCustomerNumber, type CrewCustomer } from "@ace/core";
import Link from "next/link";

export function CrewView({ customer }: { customer: CrewCustomer }) {
  return (
    <div>
      <Link href="/customers" className="text-sm text-forest hover:underline">
        ← Customers
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold text-forest">
        {customer.displayName}{" "}
        <span className="text-sm font-normal text-charcoal/50">
          {formatCustomerNumber(customer.number)}
        </span>
      </h1>
      <ul className="mt-6 space-y-4">
        {customer.properties.map((p) => (
          <li key={p.id} className="rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10">
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
                className="mt-1 inline-block text-sm text-forest underline"
              >
                Open map<span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
            {p.accessNotes ? (
              <p className="mt-2 rounded-lg bg-cream/70 p-3 text-sm text-charcoal">
                {p.accessNotes}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
