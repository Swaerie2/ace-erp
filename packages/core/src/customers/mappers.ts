import type { ContactInput, CustomerInput, PropertyInput } from "./schemas";

/** Validated form values -> database columns (blank becomes null). */
export function customerData(c: CustomerInput) {
  return {
    type: c.type,
    displayName: c.displayName,
    companyName: c.companyName ?? null,
    registrationNumber: c.registrationNumber ?? null,
    status: c.status,
    billingLine1: c.billingLine1 ?? null,
    billingLine2: c.billingLine2 ?? null,
    billingSuburb: c.billingSuburb ?? null,
    billingCity: c.billingCity ?? null,
    billingPostalCode: c.billingPostalCode ?? null,
    source: c.source ?? null,
    sourceNote: c.sourceNote ?? null,
    notes: c.notes ?? null,
    consentSource: c.consentSource ?? null,
    consentNote: c.consentNote ?? null,
  };
}

export function contactData(c: ContactInput) {
  return {
    name: c.name,
    role: c.role ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    receivesQuotes: c.receivesQuotes,
    receivesInvoices: c.receivesInvoices,
    portalAccess: c.portalAccess,
  };
}

export function propertyData(p: PropertyInput) {
  return {
    label: p.label,
    addressLine1: p.addressLine1,
    addressLine2: p.addressLine2 ?? null,
    suburb: p.suburb ?? null,
    city: p.city ?? null,
    postalCode: p.postalCode ?? null,
    mapUrl: p.mapUrl ?? null,
    accessNotes: p.accessNotes ?? null,
    lawnSizeSqm: p.lawnSizeSqm ?? null,
    grassType: p.grassType ?? null,
    hasIrrigation: p.hasIrrigation,
    terrainNotes: p.terrainNotes ?? null,
    frequency: p.frequency ?? null,
    preferredDay: p.preferredDay ?? null,
    agreedMonthlyFeeCents: p.monthlyFee ?? null,
    extrasNote: p.extrasNote ?? null,
  };
}
