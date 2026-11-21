import Papa from "papaparse";
import {
  contactSchema,
  customerSchema,
  propertySchema,
  type ContactInput,
  type CustomerInput,
  type PropertyInput,
} from "./schemas";

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export const IMPORT_COLUMNS = [
  "type",
  "display_name",
  "company_name",
  "contact_name",
  "email",
  "phone",
  "billing_line1",
  "billing_suburb",
  "billing_city",
  "billing_postal_code",
  "property_address",
  "property_suburb",
  "property_city",
  "frequency",
  "source",
  "notes",
] as const;

/** Handed out as a download. The example row is made up. */
export const IMPORT_TEMPLATE = `${IMPORT_COLUMNS.join(",")}\nperson,Sample Customer,,Sample Contact,sample@example.com,082 123 4567,1 Example Road,Exampleville,Boksburg,1459,1 Example Road,Exampleville,Boksburg,weekly,referral,Imported sample\n`;

export type RawImportRow = Record<string, string>;

/** Comma, semicolon, tab or pipe: whichever appears most in the header line (comma if none). */
function guessDelimiter(text: string): string {
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = 0;
  for (const candidate of [",", ";", "\t", "|"]) {
    const count = header.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Reads CSV text. `lines[i]` is the spreadsheet row number of `rows[i]` (header = 1). Blank rows
 * are left out of `rows` but still count, so the numbers match what the user sees in their
 * spreadsheet. Pass `lines` on to `prepareImport` / `commitImport` so errors name the right row.
 */
export function parseCsvText(
  text: string,
): { rows: RawImportRow[]; lines: number[] } | { error: string } {
  const clean = text.replace(/^\uFEFF/, "");
  const parsed = Papa.parse<Record<string, string | undefined>>(clean, {
    header: true,
    delimiter: guessDelimiter(clean),
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  if (parsed.errors.some((e) => e.type === "Quotes")) {
    return {
      error:
        "The file has a broken quote mark. Open it in a spreadsheet, save it again as CSV and retry.",
    };
  }
  if (!(parsed.meta.fields ?? []).includes("display_name")) {
    return {
      error: 'The file needs a "display_name" column. Download the template to see the layout.',
    };
  }
  const rows: RawImportRow[] = [];
  const lines: number[] = [];
  parsed.data.forEach((r, index) => {
    const out: RawImportRow = {};
    for (const column of IMPORT_COLUMNS) out[column] = (r[column] ?? "").trim();
    // A row with every cell empty is blank: not data, but it still uses up a row number.
    const blank = Object.values(r).every((v) => (typeof v === "string" ? v : "").trim() === "");
    if (blank) return;
    rows.push(out);
    lines.push(index + 2); // line 1 is the header
  });
  if (rows.length === 0) return { error: "The file has no rows." };
  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      error: `The file has more than ${MAX_IMPORT_ROWS} rows. Split it into smaller files.`,
    };
  }
  return { rows, lines };
}

export type MappedRow = {
  line: number;
  customer: CustomerInput;
  contact: ContactInput;
  property?: PropertyInput | undefined;
};

const TYPES: Record<string, "PERSON" | "COMPANY"> = {
  "": "PERSON",
  person: "PERSON",
  individual: "PERSON",
  homeowner: "PERSON",
  company: "COMPANY",
  business: "COMPANY",
  "body corporate": "COMPANY",
  agent: "COMPANY",
};
const FREQUENCIES: Record<string, string> = {
  weekly: "WEEKLY",
  fortnightly: "FORTNIGHTLY",
  "every 2 weeks": "FORTNIGHTLY",
  monthly: "MONTHLY",
  "once-off": "ONCE_OFF",
  "once off": "ONCE_OFF",
  once: "ONCE_OFF",
};
const SOURCES: Record<string, string> = {
  referral: "REFERRAL",
  google: "GOOGLE",
  facebook: "FACEBOOK",
  directory: "DIRECTORY",
  other: "OTHER",
};

/** Reads a mapping table safely: "constructor" or "__proto__" in a cell is not a key. */
function lookup<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Cell text echoed back in an error message is cut short, so a huge cell cannot flood the screen. */
const ECHO_LIMIT = 40;
function echo(text: string): string {
  return text.length > ECHO_LIMIT ? `${text.slice(0, ECHO_LIMIT)}...` : text;
}

// Which CSV column each form field came from, so errors name what the user sees in their sheet.
const CUSTOMER_COLUMNS: Record<string, string> = {
  type: "type",
  displayName: "display_name",
  companyName: "company_name",
  billingLine1: "billing_line1",
  billingSuburb: "billing_suburb",
  billingCity: "billing_city",
  billingPostalCode: "billing_postal_code",
  source: "source",
  notes: "notes",
};
const CONTACT_COLUMNS: Record<string, string> = {
  name: "contact_name",
  email: "email",
  phone: "phone",
};
const PROPERTY_COLUMNS: Record<string, string> = {
  addressLine1: "property_address",
  suburb: "property_suburb",
  city: "property_city",
  frequency: "frequency",
};

function issues(
  columns: Record<string, string>,
  fallback: string,
  error: { issues: { path: PropertyKey[]; message: string }[] },
): string[] {
  return error.issues.map((i) => {
    const field = i.path[0] === undefined ? undefined : String(i.path[0]);
    return `${(field && columns[field]) || fallback}: ${i.message}`;
  });
}

/** One spreadsheet row -> validated records, or a list of everything wrong with it. */
export function mapImportRow(
  raw: RawImportRow,
  line: number,
): { ok: true; row: MappedRow } | { ok: false; line: number; errors: string[] } {
  const errors: string[] = [];
  const get = (key: string) => raw[key] ?? "";

  const type = lookup(TYPES, get("type").toLowerCase());
  if (!type) errors.push(`type: "${echo(get("type"))}" is not person or company.`);

  const freqText = get("frequency").toLowerCase();
  const frequency = lookup(FREQUENCIES, freqText);
  if (freqText && !frequency)
    errors.push(
      `frequency: "${echo(get("frequency"))}" is not weekly, fortnightly, monthly or once-off.`,
    );

  const sourceText = get("source").toLowerCase();
  const source = lookup(SOURCES, sourceText);
  if (sourceText && !source)
    errors.push(
      `source: "${echo(get("source"))}" is not referral, google, facebook, directory or other.`,
    );

  const customer = customerSchema.safeParse({
    type: type ?? "PERSON",
    displayName: get("display_name"),
    companyName: get("company_name"),
    status: "ACTIVE",
    billingLine1: get("billing_line1"),
    billingSuburb: get("billing_suburb"),
    billingCity: get("billing_city"),
    billingPostalCode: get("billing_postal_code"),
    source: source ?? "",
    notes: get("notes"),
  });
  const contact = contactSchema.safeParse({
    name: get("contact_name") || get("display_name"),
    email: get("email"),
    phone: get("phone"),
    receivesQuotes: "on",
    receivesInvoices: "on",
  });
  const wantsProperty = get("property_address") !== "";
  const property = wantsProperty
    ? propertySchema.safeParse({
        label: "Main property",
        addressLine1: get("property_address"),
        suburb: get("property_suburb"),
        city: get("property_city"),
        frequency: frequency ?? "",
      })
    : null;

  if (!wantsProperty && freqText) {
    errors.push("property_address: needed when frequency is given.");
  }
  if (!customer.success) errors.push(...issues(CUSTOMER_COLUMNS, "display_name", customer.error));
  if (!contact.success) errors.push(...issues(CONTACT_COLUMNS, "email", contact.error));
  if (property && !property.success) {
    errors.push(...issues(PROPERTY_COLUMNS, "property_address", property.error));
  }
  if (
    errors.length > 0 ||
    !customer.success ||
    !contact.success ||
    (property && !property.success)
  ) {
    return { ok: false, line, errors };
  }
  return {
    ok: true,
    row: {
      line,
      customer: customer.data,
      contact: contact.data,
      property: property?.success ? property.data : undefined,
    },
  };
}
