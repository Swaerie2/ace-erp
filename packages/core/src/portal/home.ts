import type { CustomerStatus } from "../generated/prisma/enums";
import { publicViewState } from "../quotes/public-state";
import {
  formatDateSA,
  formatQuoteReference,
  todaySA,
  type QuoteStatusValue,
} from "../quotes/reference";
import { PORTAL_VISIBLE_STATUSES } from "./quotes";
import type { PortalScope } from "./scope";
import type { PortalStore } from "./store";

export type PortalQuoteState = "OPEN" | "EXPIRED" | "ACCEPTED" | "DECLINED";

export type PortalQuoteSummary = {
  id: string;
  reference: string;
  state: PortalQuoteState;
  issuedDate: string | null;
  validUntil: string;
};

export type PortalPropertyGroup = {
  id: string;
  label: string;
  address: string;
  quotes: PortalQuoteSummary[];
};

export type PortalCustomerGroup = {
  id: string;
  name: string;
  status: CustomerStatus;
  /** True for a complex seen through its managing agency. */
  managed: boolean;
  properties: PortalPropertyGroup[];
  /** Quotes for a property that is no longer listed (for example archived). */
  otherQuotes: PortalQuoteSummary[];
};

export type PortalHome = { hasManaged: boolean; groups: PortalCustomerGroup[] };

export type HomeQuoteRow = {
  id: string;
  customerId: string;
  propertyId: string;
  status: QuoteStatusValue;
  numberYear: number | null;
  numberSeq: number | null;
  revision: number;
  validUntil: Date;
  issuedAt: Date | null;
};

const SHOWN: readonly string[] = ["OPEN", "EXPIRED", "ACCEPTED", "DECLINED"];

/** Groups the rows by customer and property. Pure, so the shape is unit-tested without a database. */
export function groupPortalHome(input: {
  customers: { id: string; displayName: string; status: CustomerStatus }[];
  properties: {
    id: string;
    customerId: string;
    label: string;
    addressLine1: string;
    addressLine2: string | null;
    suburb: string | null;
    city: string | null;
    postalCode: string | null;
  }[];
  quotes: HomeQuoteRow[];
  managedCustomerIds: readonly string[];
  today: string;
}): PortalCustomerGroup[] {
  const managed = new Set(input.managedCustomerIds);
  const byCustomer = new Map<string, PortalCustomerGroup>();
  for (const c of input.customers) {
    byCustomer.set(c.id, {
      id: c.id,
      name: c.displayName,
      status: c.status,
      managed: managed.has(c.id),
      properties: [],
      otherQuotes: [],
    });
  }
  const byProperty = new Map<string, PortalPropertyGroup>();
  for (const p of [...input.properties].sort((a, b) => a.label.localeCompare(b.label))) {
    const group = byCustomer.get(p.customerId);
    if (!group) continue;
    const property: PortalPropertyGroup = {
      id: p.id,
      label: p.label,
      address: [p.addressLine1, p.addressLine2, p.suburb, p.city, p.postalCode]
        .filter(Boolean)
        .join(", "),
      quotes: [],
    };
    group.properties.push(property);
    byProperty.set(p.id, property);
  }
  const newestFirst = [...input.quotes].sort(
    (a, b) => (b.issuedAt?.getTime() ?? 0) - (a.issuedAt?.getTime() ?? 0),
  );
  for (const q of newestFirst) {
    const state = publicViewState(q, input.today);
    if (!state || !SHOWN.includes(state)) continue;
    const summary: PortalQuoteSummary = {
      id: q.id,
      reference: formatQuoteReference(q) ?? "",
      state: state as PortalQuoteState,
      issuedDate: q.issuedAt ? formatDateSA(q.issuedAt) : null,
      validUntil: formatDateSA(q.validUntil),
    };
    const property = byProperty.get(q.propertyId);
    if (property) property.quotes.push(summary);
    else byCustomer.get(q.customerId)?.otherQuotes.push(summary);
  }
  return [...byCustomer.values()].sort(
    (a, b) => Number(a.managed) - Number(b.managed) || a.name.localeCompare(b.name),
  );
}

/**
 * The home page: every customer in the scope (own first, then managed complexes) with its properties and
 * quotes. `q` filters by customer (complex) name. Every query is restricted to the scope.
 */
export async function getPortalHome(
  store: PortalStore,
  scope: PortalScope,
  opts: { q?: string } = {},
  now: Date = new Date(),
): Promise<PortalHome> {
  const term = (opts.q ?? "").trim().slice(0, 80);
  const customers = await store.customer.findMany({
    where: {
      id: { in: [...scope.customerIds] },
      ...(term ? { displayName: { contains: term, mode: "insensitive" as const } } : {}),
    },
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, status: true },
  });
  const ids = customers.map((c) => c.id);
  const properties =
    ids.length === 0
      ? []
      : await store.property.findMany({
          where: { customerId: { in: ids }, archivedAt: null },
          orderBy: { label: "asc" },
          select: {
            id: true,
            customerId: true,
            label: true,
            addressLine1: true,
            addressLine2: true,
            suburb: true,
            city: true,
            postalCode: true,
          },
        });
  const quotes =
    ids.length === 0
      ? []
      : await store.quote.findMany({
          where: { customerId: { in: ids }, status: { in: [...PORTAL_VISIBLE_STATUSES] } },
          orderBy: { issuedAt: "desc" },
          select: {
            id: true,
            customerId: true,
            propertyId: true,
            status: true,
            numberYear: true,
            numberSeq: true,
            revision: true,
            validUntil: true,
            issuedAt: true,
          },
        });
  return {
    hasManaged: scope.managedCustomerIds.length > 0,
    groups: groupPortalHome({
      customers,
      properties,
      quotes,
      managedCustomerIds: scope.managedCustomerIds,
      today: todaySA(now),
    }),
  };
}
