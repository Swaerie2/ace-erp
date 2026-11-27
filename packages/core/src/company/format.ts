// No imports on purpose: the quote builder (a browser component) uses this through snapshotWording.

/** The company's own physical address, part by part. A business address, not personal data. */
export type CompanyAddressParts = {
  line1: string;
  line2: string;
  suburb: string;
  city: string;
  postalCode: string;
};

export const BLANK_COMPANY_ADDRESS: CompanyAddressParts = {
  line1: "",
  line2: "",
  suburb: "",
  city: "",
  postalCode: "",
};

/** The address as one line for a document: the non-blank parts joined with ", ", or null when all are blank. */
export function formatCompanyAddress(parts: CompanyAddressParts): string | null {
  const text = [parts.line1, parts.line2, parts.suburb, parts.city, parts.postalCode]
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p !== "")
    .join(", ");
  return text === "" ? null : text;
}

/** The address columns of organisation_settings, as one line (null when blank). */
export function companyAddressFromSettings(org: {
  addressLine1?: string;
  addressLine2?: string;
  addressSuburb?: string;
  addressCity?: string;
  addressPostalCode?: string;
}): string | null {
  return formatCompanyAddress({
    line1: org.addressLine1 ?? "",
    line2: org.addressLine2 ?? "",
    suburb: org.addressSuburb ?? "",
    city: org.addressCity ?? "",
    postalCode: org.addressPostalCode ?? "",
  });
}
