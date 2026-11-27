import { recordAudit, staffParty } from "../audit";
import { companyAddressFromSettings } from "../company/format";
import { assertRole, DomainError, MANAGEMENT, OWNER_ONLY, type Actor } from "../customers/access";
import { formatCustomerNumber } from "../customers/number";
import { changedFields, lockCustomer, logCustomerEvent } from "../customers/store";
import type { Db } from "../db";
import { readQuoteWording } from "../quotes/wording";
import { BILLING_TIMINGS, type BillingTiming } from "./labels";
import { bankDetailsReady, type InvoiceSettingsInput, type InvoiceSnapshot } from "./schemas";

const SETTINGS_SELECT = {
  bankName: true,
  accountHolder: true,
  accountNumber: true,
  branchCode: true,
  accountType: true,
  onceOffDueDays: true,
  lateFeeCents: true,
  updatedAt: true,
} as const;

export type InvoiceSettingsRow = {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  branchCode: string;
  accountType: string;
  onceOffDueDays: number;
  lateFeeCents: number;
  updatedAt: Date;
};

/** Reads the one settings row. No role check: for use inside core functions only (not in the barrel). */
export async function readInvoiceSettings(
  store: Pick<Db, "invoiceSettings">,
): Promise<InvoiceSettingsRow> {
  return store.invoiceSettings.findUniqueOrThrow({
    where: { id: "singleton" },
    select: SETTINGS_SELECT,
  });
}

/** Owner only: the settings page. */
export async function getInvoiceSettings(
  store: Pick<Db, "invoiceSettings">,
  actor: Actor,
): Promise<InvoiceSettingsRow> {
  assertRole(actor, OWNER_ONLY);
  return readInvoiceSettings(store);
}

/** What managers need to know without seeing the bank details. */
export async function invoiceSettingsStatus(
  store: Pick<Db, "invoiceSettings">,
  actor: Actor,
): Promise<{ bankReady: boolean; onceOffDueDays: number; lateFeeCents: number }> {
  assertRole(actor, MANAGEMENT);
  const s = await readInvoiceSettings(store);
  return {
    bankReady: bankDetailsReady(s),
    onceOffDueDays: s.onceOffDueDays,
    lateFeeCents: s.lateFeeCents,
  };
}

/**
 * Owner only. Changes apply to invoices issued afterwards; issued invoices keep their frozen copy. A save that
 * changes nothing writes nothing. The audit line names the changed fields only, never the values.
 * Run it inside a transaction: the settings row is locked first, so two saves at once cannot work out their
 * changed-field lists from the same stale values.
 */
export async function updateInvoiceSettings(
  store: Pick<Db, "invoiceSettings" | "auditLog" | "$queryRaw">,
  actor: Actor,
  input: InvoiceSettingsInput,
): Promise<void> {
  assertRole(actor, OWNER_ONLY);
  await store.$queryRaw`select "id" from "invoice_settings" where "id" = 'singleton' for update`;
  const current = await readInvoiceSettings(store);
  const before: Record<string, unknown> = {
    bankName: current.bankName,
    accountHolder: current.accountHolder,
    accountNumber: current.accountNumber,
    branchCode: current.branchCode,
    accountType: current.accountType,
    onceOffDueDays: current.onceOffDueDays,
    lateFeeCents: current.lateFeeCents,
  };
  const changed = changedFields(before, input);
  if (changed.length === 0) return;
  await store.invoiceSettings.update({
    where: { id: "singleton" },
    data: { ...input, updatedById: actor.id },
    select: { id: true },
  });
  const party = staffParty(actor);
  await recordAudit(store, {
    actorType: party.actorType,
    actorId: actor.id,
    action: "invoice_settings.updated",
    entityType: "invoice_settings",
    entityId: "singleton",
    after: { changed },
    ...(party.ip ? { ip: party.ip } : {}),
    ...(party.userAgent ? { userAgent: party.userAgent } : {}),
  });
}

/** The customer's current timing; refuses a missing or anonymised customer (same words as the customer store). */
async function readEditableTiming(
  store: Pick<Db, "customer">,
  customerId: string,
): Promise<BillingTiming> {
  const customer = await store.customer.findUnique({
    where: { id: customerId },
    select: { billingTiming: true, anonymisedAt: true },
  });
  if (!customer) throw new DomainError("That customer could not be found.");
  if (customer.anonymisedAt) {
    throw new DomainError("This customer has been anonymised and cannot be changed.");
  }
  return customer.billingTiming;
}

/** The Pre or Post switch on a customer. Owner or manager. A choice that is already set writes nothing. */
export async function setBillingTiming(
  store: Pick<Db, "customer" | "auditLog">,
  actor: Actor,
  customerId: string,
  timing: BillingTiming,
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  if (!BILLING_TIMINGS.includes(timing)) throw new DomainError("Choose Pre or Post.");
  if ((await readEditableTiming(store, customerId)) === timing) return;
  await lockCustomer(store, customerId);
  if ((await readEditableTiming(store, customerId)) === timing) return;
  await store.customer.update({
    where: { id: customerId },
    data: { billingTiming: timing },
    select: { id: true },
  });
  await logCustomerEvent(store, actor, "customer.billing_timing_changed", customerId, {
    billingTiming: timing,
  });
}

/**
 * ACE's details as printed on an invoice. No role check: core use only (not in the barrel). The issued
 * invoice's content hash covers this snapshot, so a blank company address leaves the `address` key out
 * (never `address: null`): an invoice with no address hashes exactly as it did before addresses existed.
 */
export async function buildInvoiceSnapshot(
  store: Pick<Db, "organisationSettings" | "quoteWording">,
  settings: InvoiceSettingsRow,
  billToNumber: number,
): Promise<InvoiceSnapshot> {
  const org = await store.organisationSettings.findUniqueOrThrow({
    where: { id: "singleton" },
    select: {
      legalName: true,
      tradingName: true,
      addressLine1: true,
      addressLine2: true,
      addressSuburb: true,
      addressCity: true,
      addressPostalCode: true,
    },
  });
  const address = companyAddressFromSettings(org);
  const wording = await readQuoteWording(store);
  return {
    bank: {
      bankName: settings.bankName,
      accountHolder: settings.accountHolder,
      accountNumber: settings.accountNumber,
      branchCode: settings.branchCode,
      accountType: settings.accountType,
    },
    business: {
      legalName: org.legalName,
      tradingName: org.tradingName,
      registrationNumber: wording.registrationNumber,
      phone: wording.phone,
      email: wording.email,
      website: wording.website,
      ...(address === null ? {} : { address }),
    },
    paymentReference: formatCustomerNumber(billToNumber),
  };
}
