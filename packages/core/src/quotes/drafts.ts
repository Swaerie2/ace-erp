import { assertRole, DomainError, MANAGEMENT, type Actor } from "../customers/access";
import type { Prisma } from "../generated/prisma/client";
import {
  addDays,
  displayStatus,
  formatQuoteReference,
  fromDateString,
  toDateString,
  todaySA,
} from "./reference";
import { normaliseLine, type DraftInput } from "./schemas";
import {
  DraftConflictError,
  findQuote,
  lockQuote,
  logQuoteEvent,
  QUOTE_INCLUDE,
  requireQuotable,
  type QuoteStore,
} from "./store";
import { quoteTotals } from "./totals";
import { readQuoteWording } from "./wording";

const SERVICE_ORDER: Prisma.ServiceOrderByWithRelationInput[] = [
  { sortOrder: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
];

/** Starts a draft for one customer and one property. Every active service starts as Not included. */
export async function createQuote(
  store: QuoteStore,
  actor: Actor,
  input: { customerId: string; propertyId: string },
): Promise<{ id: string }> {
  assertRole(actor, MANAGEMENT);
  await requireQuotable(store, input.customerId, input.propertyId);
  const wording = await readQuoteWording(store);
  const services = await store.service.findMany({
    where: { archivedAt: null },
    orderBy: SERVICE_ORDER,
  });
  const created = await store.quote.create({
    data: {
      customerId: input.customerId,
      propertyId: input.propertyId,
      createdById: actor.id,
      validUntil: fromDateString(addDays(todaySA(), wording.defaultValidityDays)),
      scopeItems: {
        create: services.map((s, index) => ({
          serviceId: s.id,
          sortOrder: index + 1,
          included: false,
          name: s.name,
          description: s.description,
          kind: s.kind,
        })),
      },
    },
    select: { id: true },
  });
  await logQuoteEvent(store, actor, "quote.created", created.id);
  return created;
}

type LineShape = {
  lineKind: string;
  billing: string | null;
  frequency: string | null;
  description: string;
  amountCents: number | null;
};

function sameLines(existing: LineShape[], next: LineShape[]): boolean {
  return (
    existing.length === next.length &&
    existing.every((l, i) => {
      const n = next[i];
      return (
        n !== undefined &&
        l.lineKind === n.lineKind &&
        l.billing === n.billing &&
        l.frequency === n.frequency &&
        l.description === n.description &&
        l.amountCents === n.amountCents
      );
    })
  );
}

/**
 * Saves the whole draft in one go (scope switches, price lines, valid-until date, internal note).
 * `input.version` must be the version the browser last saw. A save that changes nothing writes
 * nothing and returns the same version. Drafts are not audited.
 */
export async function saveDraft(
  store: QuoteStore,
  actor: Actor,
  id: string,
  input: DraftInput,
): Promise<{ version: number }> {
  assertRole(actor, MANAGEMENT);
  const read = async () => {
    const quote = await findQuote(store, id);
    if (quote.status !== "DRAFT") throw new DomainError("Only a draft can be changed.");
    if (quote.draftVersion !== input.version) throw new DraftConflictError();
    return quote;
  };
  const lines = input.lines.map(normaliseLine);
  const note = input.internalNote.trim();

  // Look first WITHOUT locking: a save that changes nothing must write nothing.
  const first = await read();
  const known = new Set(first.scopeItems.map((s) => s.serviceId));
  if (input.scope.some((s) => !known.has(s.serviceId))) {
    throw new DomainError("That service is not on this quote.");
  }
  const flags = new Map(input.scope.map((s) => [s.serviceId, s.included]));
  const same =
    toDateString(first.validUntil) === input.validUntil &&
    (first.internalNote ?? "") === note &&
    first.scopeItems.every(
      (s) => !flags.has(s.serviceId) || flags.get(s.serviceId) === s.included,
    ) &&
    sameLines(first.lines, lines);
  if (same) return { version: first.draftVersion };

  await lockQuote(store, id);
  const quote = await read();
  // Anonymise scrubs this quote row, so it had to wait for the lock above: this read is current.
  const owner = await store.customer.findUnique({
    where: { id: quote.customerId },
    select: { anonymisedAt: true },
  });
  if (owner?.anonymisedAt) {
    throw new DomainError("This customer has been anonymised and cannot be changed.");
  }
  for (const item of quote.scopeItems) {
    const included = flags.get(item.serviceId);
    if (included !== undefined && included !== item.included) {
      await store.quoteScopeItem.update({ where: { id: item.id }, data: { included } });
    }
  }
  await store.quoteLine.deleteMany({ where: { quoteId: id } });
  if (lines.length > 0) {
    await store.quoteLine.createMany({
      data: lines.map((l, index) => ({
        quoteId: id,
        sortOrder: index + 1,
        lineKind: l.lineKind,
        billing: l.billing,
        frequency: l.frequency,
        description: l.description,
        amountCents: l.amountCents,
      })),
    });
  }
  const updated = await store.quote.update({
    where: { id },
    data: {
      validUntil: fromDateString(input.validUntil),
      internalNote: note === "" ? null : note,
      draftVersion: { increment: 1 },
    },
    select: { draftVersion: true },
  });
  return { version: updated.draftVersion };
}

/** Only a quote that was never issued can be deleted. */
export async function deleteDraft(store: QuoteStore, actor: Actor, id: string): Promise<void> {
  assertRole(actor, MANAGEMENT);
  if ((await findQuote(store, id)).status !== "DRAFT") {
    throw new DomainError("Only a draft can be deleted.");
  }
  await lockQuote(store, id);
  if ((await findQuote(store, id)).status !== "DRAFT") {
    throw new DomainError("Only a draft can be deleted.");
  }
  await store.quoteLine.deleteMany({ where: { quoteId: id } });
  await store.quoteScopeItem.deleteMany({ where: { quoteId: id } });
  await store.quote.delete({ where: { id } });
  await logQuoteEvent(store, actor, "quote.deleted_draft", id);
}

export async function getQuote(store: QuoteStore, actor: Actor, id: string) {
  assertRole(actor, MANAGEMENT);
  return store.quote.findUnique({
    where: { id },
    include: {
      ...QUOTE_INCLUDE,
      customer: {
        select: { id: true, number: true, displayName: true, status: true, anonymisedAt: true },
      },
      property: {
        select: {
          id: true,
          label: true,
          addressLine1: true,
          addressLine2: true,
          suburb: true,
          city: true,
          lawnSizeSqm: true,
          accessNotes: true,
          archivedAt: true,
        },
      },
      acceptedByContact: {
        select: {
          id: true,
          name: true,
          customerId: true,
          customer: { select: { id: true, displayName: true } },
        },
      },
    },
  });
}

export const QUOTE_FILTERS = [
  "DRAFT",
  "ISSUED",
  "EXPIRED",
  "ACCEPTED",
  "DECLINED",
  "REPLACED",
  "WITHDRAWN",
] as const;

export type QuoteListQuery = {
  status?: string | undefined;
  q?: string | undefined;
  customerId?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
};

function buildWhere(query: QuoteListQuery, today: string): Prisma.QuoteWhereInput {
  const and: Prisma.QuoteWhereInput[] = [];
  if (query.customerId) and.push({ customerId: query.customerId });
  const status = QUOTE_FILTERS.find((f) => f === query.status);
  const todayDate = fromDateString(today);
  if (status === "EXPIRED") and.push({ status: "ISSUED", validUntil: { lt: todayDate } });
  else if (status === "ISSUED") and.push({ status: "ISSUED", validUntil: { gte: todayDate } });
  else if (status) and.push({ status });

  const term = query.q?.trim();
  if (term) {
    const or: Prisma.QuoteWhereInput[] = [
      { customer: { displayName: { contains: term, mode: "insensitive" } } },
    ];
    // "QUO-2026-0104", "2026-104" or "104", optionally followed by a revision mark such as " R2".
    const ref = /^(?:quo-)?(?:(\d{4})-)?(\d{1,6})(?:\s*r(\d+))?$/i.exec(term);
    if (ref?.[2]) {
      or.push({
        numberSeq: Number(ref[2]),
        ...(ref[1] ? { numberYear: Number(ref[1]) } : {}),
        ...(ref[3] ? { revision: Number(ref[3]) } : {}),
      });
    }
    and.push({ OR: or });
  }
  return { AND: and };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const whole = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, whole));
}

export async function listQuotes(store: QuoteStore, actor: Actor, query: QuoteListQuery) {
  assertRole(actor, MANAGEMENT);
  const pageSize = clampInt(query.pageSize, 1, 100, 25);
  const page = clampInt(query.page, 1, 10_000, 1);
  const today = todaySA();
  const where = buildWhere(query, today);
  const rows = await store.quote.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      status: true,
      numberYear: true,
      numberSeq: true,
      revision: true,
      validUntil: true,
      issuedAt: true,
      acceptedAt: true,
      siteLabel: true,
      property: { select: { label: true } },
      customer: { select: { id: true, number: true, displayName: true } },
      lines: { select: { lineKind: true, billing: true, amountCents: true, chosen: true } },
    },
  });
  const total = await store.quote.count({ where });
  const items = rows.map((r) => ({
    id: r.id,
    reference: formatQuoteReference(r),
    displayStatus: displayStatus(r, today),
    validUntil: r.validUntil,
    issuedAt: r.issuedAt,
    acceptedAt: r.acceptedAt,
    customer: r.customer,
    siteLabel: r.siteLabel ?? r.property.label,
    totals: quoteTotals(r.lines),
  }));
  return { items, total, page, pageSize };
}
