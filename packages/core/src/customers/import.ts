import { randomUUID } from "node:crypto";
import { recordAudit } from "../audit";
import { assertRole, DomainError, MANAGEMENT, type Actor } from "./access";
import { MAX_IMPORT_ROWS, mapImportRow, type MappedRow, type RawImportRow } from "./csv";
import { contactData, customerData, propertyData } from "./mappers";
import type { Store } from "./store";

export type ImportPreview = {
  create: MappedRow[];
  duplicates: { line: number; displayName: string; reason: string }[];
  errors: { line: number; errors: string[] }[];
};

const key = (name: string, address: string) =>
  `${name.trim().toLowerCase()}|${address.trim().toLowerCase()}`;

/**
 * Sorts spreadsheet rows into: will be created, looks like a duplicate (skipped) and has errors
 * (skipped). Changes nothing. Also used by `commitImport`, so what you preview is what you get.
 * Line numbers match the spreadsheet (header = line 1). Pass the `lines` that `parseCsvText`
 * returned so blank rows in the file do not shift them; without `lines`, row i is line i + 2.
 */
export async function prepareImport(
  store: Store,
  actor: Actor,
  raw: RawImportRow[],
  lines?: number[],
): Promise<ImportPreview> {
  assertRole(actor, MANAGEMENT);
  if (raw.length > MAX_IMPORT_ROWS)
    throw new DomainError(`Imports are limited to ${MAX_IMPORT_ROWS} rows.`);
  if (lines && lines.length !== raw.length)
    throw new DomainError("The row numbers do not match the rows.");

  const contacts = await store.contact.findMany({
    where: { customer: { anonymisedAt: null } },
    select: { email: true, phone: true },
  });
  const emails = new Set(contacts.flatMap((c) => (c.email ? [c.email] : [])));
  const phones = new Set(contacts.flatMap((c) => (c.phone ? [c.phone] : [])));

  const customers = await store.customer.findMany({
    where: { anonymisedAt: null },
    select: { displayName: true, properties: { select: { addressLine1: true } } },
  });
  const nameAddress = new Set<string>();
  for (const c of customers) {
    nameAddress.add(key(c.displayName, ""));
    for (const p of c.properties) nameAddress.add(key(c.displayName, p.addressLine1));
  }

  const preview: ImportPreview = { create: [], duplicates: [], errors: [] };
  raw.forEach((rawRow, index) => {
    const line = lines?.[index] ?? index + 2; // line 1 is the header
    const mapped = mapImportRow(rawRow, line);
    if (!mapped.ok) {
      preview.errors.push({ line, errors: mapped.errors });
      return;
    }
    const { customer, contact, property } = mapped.row;
    const nameKey = key(customer.displayName, property?.addressLine1 ?? "");
    let reason: string | null = null;
    if (contact.email && emails.has(contact.email)) reason = "email already used";
    else if (contact.phone && phones.has(contact.phone)) reason = "phone already used";
    else if (nameAddress.has(nameKey)) reason = "same name and address";
    if (reason) {
      preview.duplicates.push({ line, displayName: customer.displayName, reason });
      return;
    }
    // Remember it, so the same person twice in one file is caught too.
    if (contact.email) emails.add(contact.email);
    if (contact.phone) phones.add(contact.phone);
    nameAddress.add(nameKey);
    preview.create.push(mapped.row);
  });
  return preview;
}

/**
 * Creates the good rows in three bulk inserts and writes one audit line (counts only).
 *
 * All-or-nothing ONLY when the caller passes a transaction store: call it inside `inTx`, and
 * give `inTx` a long `timeoutMs` for big files (the 15 s default is too short for 2,000 rows).
 * With the plain connection, a failure half way would leave the earlier inserts in place.
 */
export async function commitImport(
  store: Store,
  actor: Actor,
  raw: RawImportRow[],
  lines?: number[],
) {
  const preview = await prepareImport(store, actor, raw, lines);
  const rows = preview.create.map((row) => ({ id: randomUUID(), row }));

  if (rows.length > 0) {
    await store.customer.createMany({
      data: rows.map(({ id, row }) => ({
        id,
        ...customerData(row.customer),
        consentAt: null,
        createdById: actor.id,
      })),
    });
    await store.contact.createMany({
      data: rows.map(({ id, row }) => ({ customerId: id, ...contactData(row.contact) })),
    });
    const withProperty = rows.flatMap(({ id, row }) =>
      row.property ? [{ customerId: id, ...propertyData(row.property) }] : [],
    );
    if (withProperty.length > 0) await store.property.createMany({ data: withProperty });
  }

  const summary = {
    created: preview.create.length,
    duplicates: preview.duplicates.length,
    errors: preview.errors.length,
  };
  await recordAudit(store, {
    actorType: "STAFF",
    actorId: actor.id,
    action: "customer.imported",
    entityType: "customer_import",
    after: summary, // counts only, no personal details
    ...(actor.ip ? { ip: actor.ip } : {}),
    ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
  });
  return summary;
}
