import { recordAudit, staffParty } from "../audit";
import { assertRole, DomainError, MANAGEMENT, OWNER_ONLY, type Actor } from "../customers/access";
import { changedFields } from "../customers/store";
import type { Db } from "../db";
import { readQuoteWording } from "../quotes/wording";
import { companyAddressSchema, type CompanyAddressInput } from "./address";
import type { CompanyAddressParts } from "./format";
import { inspectLogo, type LogoContentType } from "./logo";

/** What the company profile functions need. Works with the normal connection or a transaction. */
export type CompanyStore = Pick<
  Db,
  "companyLogo" | "organisationSettings" | "quoteWording" | "auditLog" | "$queryRaw"
>;
/** The logo reads. The portal's database login may select exactly these columns of company_logo. */
export type LogoStore = Pick<Db, "companyLogo">;

export type CompanyLogoMeta = { contentType: LogoContentType; byteSize: number; updatedAt: Date };
export type PdfLogo = { data: Uint8Array; format: "png" | "jpg" };

export type CompanyProfile = {
  legalName: string;
  tradingName: string;
  registrationNumber: string;
  phone: string;
  email: string;
  website: string;
  address: CompanyAddressParts;
  logo: { contentType: LogoContentType; byteSize: number; version: string } | null;
};

const asLogoType = (value: string): LogoContentType | null =>
  value === "image/png" || value === "image/jpeg" ? value : null;
/** The cache buster for the logo URL: the time it was last changed, in milliseconds. */
const versionOf = (updatedAt: Date) => String(updatedAt.getTime());

/**
 * Company profile writes (logo and address) take the organisation settings row lock first, the same way
 * updateInvoiceSettings locks its row. That row always exists (the logo row may not), so two saves at once
 * queue instead of both working from the same stale values. Run the callers inside a transaction.
 */
async function lockCompanyProfile(store: Pick<Db, "$queryRaw">): Promise<void> {
  await store.$queryRaw`select "id" from "organisation_settings" where "id" = 'singleton' for update`;
}

async function logCompanyEvent(
  store: Pick<Db, "auditLog">,
  actor: Actor,
  action: "company.logo_set" | "company.logo_removed" | "company.address_changed",
  after?: { contentType: string; byteSize: number } | { fields: string[] },
): Promise<void> {
  const party = staffParty(actor);
  await recordAudit(store, {
    actorType: party.actorType,
    actorId: actor.id,
    action,
    entityType: "company_profile",
    entityId: "singleton",
    ...(after ? { after } : {}),
    ...(party.ip ? { ip: party.ip } : {}),
    ...(party.userAgent ? { userAgent: party.userAgent } : {}),
  });
}

// --- logo ---------------------------------------------------------------------------------------

/**
 * Owner only. Checks the picture by its own bytes (PNG or JPEG, at most 500 KB, a sensible size) and stores
 * it as the one logo, replacing any earlier one. A refused file throws a DomainError with a plain sentence
 * and leaves the stored logo as it was. The audit line holds the type and size only, never the picture.
 */
export async function setCompanyLogo(
  store: CompanyStore,
  actor: Actor,
  bytes: Uint8Array,
): Promise<void> {
  assertRole(actor, OWNER_ONLY);
  const check = inspectLogo(bytes);
  if (!check.ok) throw new DomainError(check.problem);
  await lockCompanyProfile(store);
  const data = Uint8Array.from(bytes);
  const fields = {
    data,
    contentType: check.contentType,
    byteSize: check.byteSize,
    updatedById: actor.id,
  };
  await store.companyLogo.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...fields },
    update: fields,
    select: { id: true },
  });
  await logCompanyEvent(store, actor, "company.logo_set", {
    contentType: check.contentType,
    byteSize: check.byteSize,
  });
}

/** Owner only. Removes the logo. When there is none this writes nothing (and no audit line). */
export async function removeCompanyLogo(store: CompanyStore, actor: Actor): Promise<void> {
  assertRole(actor, OWNER_ONLY);
  await lockCompanyProfile(store);
  const { count } = await store.companyLogo.deleteMany({ where: { id: "singleton" } });
  if (count === 0) return;
  await logCompanyEvent(store, actor, "company.logo_removed");
}

/** Owner or manager: whether there is a logo, without the picture itself. */
export async function getCompanyLogoMeta(
  store: LogoStore,
  actor: Actor,
): Promise<CompanyLogoMeta | null> {
  assertRole(actor, MANAGEMENT);
  const row = await store.companyLogo.findUnique({
    where: { id: "singleton" },
    select: { contentType: true, byteSize: true, updatedAt: true },
  });
  const contentType = row ? asLogoType(row.contentType) : null;
  if (!row || !contentType) return null;
  return { contentType, byteSize: row.byteSize, updatedAt: row.updatedAt };
}

/**
 * The logo picture. No role check: core use only (NOT in the barrel). Selects only columns the portal's
 * database login may read, so it works there too. Null when there is no logo.
 */
export async function readCompanyLogo(
  store: LogoStore,
): Promise<{ data: Uint8Array; contentType: LogoContentType; updatedAt: Date } | null> {
  const row = await store.companyLogo.findUnique({
    where: { id: "singleton" },
    select: { data: true, contentType: true, updatedAt: true },
  });
  const contentType = row ? asLogoType(row.contentType) : null;
  if (!row || !contentType) return null;
  return { data: row.data, contentType, updatedAt: row.updatedAt };
}

/** The logo's cache buster (its change time in milliseconds), or null. No role check: NOT in the barrel. */
export async function readCompanyLogoVersion(store: LogoStore): Promise<string | null> {
  const row = await store.companyLogo.findUnique({
    where: { id: "singleton" },
    select: { updatedAt: true },
  });
  return row ? versionOf(row.updatedAt) : null;
}

/** The logo in the shape the PDF library draws. Core use only: the barrel exports role-checked wrappers. */
export async function loadLogoForPdf(store: LogoStore): Promise<PdfLogo | null> {
  const logo = await readCompanyLogo(store);
  if (!logo) return null;
  return { data: logo.data, format: logo.contentType === "image/png" ? "png" : "jpg" };
}

/** Owner or manager: the logo for a staff PDF (invoice, statement or quote). Null when there is none. */
export async function getLogoForPdf(store: LogoStore, actor: Actor): Promise<PdfLogo | null> {
  assertRole(actor, MANAGEMENT);
  return loadLogoForPdf(store);
}

// --- profile and address ------------------------------------------------------------------------

const ADDRESS_SELECT = {
  addressLine1: true,
  addressLine2: true,
  addressSuburb: true,
  addressCity: true,
  addressPostalCode: true,
} as const;

/**
 * Owner or manager: the company details as the Company profile page shows them. The registration number and
 * the contact details are edited in Quote wording and are display-only here.
 */
export async function getCompanyProfile(
  store: Pick<Db, "companyLogo" | "organisationSettings" | "quoteWording">,
  actor: Actor,
): Promise<CompanyProfile> {
  assertRole(actor, MANAGEMENT);
  const org = await store.organisationSettings.findUniqueOrThrow({
    where: { id: "singleton" },
    select: { legalName: true, tradingName: true, ...ADDRESS_SELECT },
  });
  const wording = await readQuoteWording(store);
  const logo = await getCompanyLogoMeta(store, actor);
  return {
    legalName: org.legalName,
    tradingName: org.tradingName,
    registrationNumber: wording.registrationNumber,
    phone: wording.phone,
    email: wording.email,
    website: wording.website,
    address: {
      line1: org.addressLine1,
      line2: org.addressLine2,
      suburb: org.addressSuburb,
      city: org.addressCity,
      postalCode: org.addressPostalCode,
    },
    logo: logo
      ? {
          contentType: logo.contentType,
          byteSize: logo.byteSize,
          version: versionOf(logo.updatedAt),
        }
      : null,
  };
}

/**
 * Owner only. Saves the company address printed on documents issued afterwards (issued invoices and quotes
 * keep their frozen copy). A save that changes nothing writes nothing. The audit line names the changed
 * fields only, never the address. Run it inside a transaction: the settings row is locked first.
 */
export async function updateCompanyAddress(
  store: CompanyStore,
  actor: Actor,
  input: CompanyAddressInput,
): Promise<void> {
  assertRole(actor, OWNER_ONLY);
  const parsed = companyAddressSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError(parsed.error.issues[0]?.message ?? "Check the address and try again.");
  }
  const next = parsed.data;
  await lockCompanyProfile(store);
  const current = await store.organisationSettings.findUniqueOrThrow({
    where: { id: "singleton" },
    select: ADDRESS_SELECT,
  });
  const before: Record<string, unknown> = {
    line1: current.addressLine1,
    line2: current.addressLine2,
    suburb: current.addressSuburb,
    city: current.addressCity,
    postalCode: current.addressPostalCode,
  };
  const fields = changedFields(before, next);
  if (fields.length === 0) return;
  await store.organisationSettings.update({
    where: { id: "singleton" },
    data: {
      addressLine1: next.line1,
      addressLine2: next.line2,
      addressSuburb: next.suburb,
      addressCity: next.city,
      addressPostalCode: next.postalCode,
    },
    select: { id: true },
  });
  await logCompanyEvent(store, actor, "company.address_changed", { fields });
}
