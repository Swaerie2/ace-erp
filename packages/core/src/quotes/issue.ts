import { assertRole, DomainError, MANAGEMENT, type Actor } from "../customers/access";
import type { Prisma } from "../generated/prisma/client";
import { contentHash } from "./content";
import {
  addDays,
  formatQuoteReference,
  fromDateString,
  toDateString,
  todaySA,
  yearSA,
} from "./reference";
import { validateForIssue } from "./schemas";
import { findQuote, lockQuote, logQuoteEvent, requireQuotable, type QuoteStore } from "./store";
import { readQuoteWording } from "./wording";
import { snapshotWording } from "./wording-schema";

type SentMethod = "WHATSAPP" | "EMAIL" | "HAND" | "OTHER";

/** An incomplete quote cannot be issued. `problems` are plain sentences; the message joins them. */
export class QuoteIssueError extends DomainError {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join("\n"));
    this.name = "QuoteIssueError";
    this.problems = problems;
  }
}

/** The next running number for the year, taken with one atomic statement (no repeats, no gaps). */
export async function allocateQuoteNumber(store: QuoteStore, year: number): Promise<number> {
  const rows = await store.$queryRaw<{ lastSeq: number }[]>`
    insert into quote_counters ("year", "lastSeq") values (${year}, 1)
    on conflict ("year") do update set "lastSeq" = quote_counters."lastSeq" + 1
    returning "lastSeq"`;
  const seq = rows[0]?.lastSeq;
  if (seq === undefined) throw new Error("Could not allocate a quote number.");
  return Number(seq);
}

const SERVICE_ORDER: Prisma.ServiceOrderByWithRelationInput[] = [
  { sortOrder: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
];

/**
 * Brings the quote's scope up to date with the catalogue just before issuing: every active service
 * appears (new ones as Not included), a switched-off service stays only if it was included, and
 * every row takes the catalogue's current wording and order.
 */
async function refreshScope(store: QuoteStore, quote: Awaited<ReturnType<typeof findQuote>>) {
  const services = await store.service.findMany({ orderBy: SERVICE_ORDER });
  const existing = new Map(quote.scopeItems.map((s) => [s.serviceId, s]));
  const keep = services.filter((s) => !s.archivedAt || existing.get(s.id)?.included);
  const keepIds = new Set(keep.map((s) => s.id));
  for (const item of quote.scopeItems) {
    if (!keepIds.has(item.serviceId)) {
      await store.quoteScopeItem.delete({ where: { id: item.id } });
    }
  }
  for (const [index, service] of keep.entries()) {
    const item = existing.get(service.id);
    const wording = {
      sortOrder: index + 1,
      name: service.name,
      description: service.description,
      kind: service.kind,
    };
    if (!item) {
      await store.quoteScopeItem.create({
        data: { quoteId: quote.id, serviceId: service.id, included: false, ...wording },
      });
    } else if (
      item.sortOrder !== wording.sortOrder ||
      item.name !== wording.name ||
      item.description !== wording.description ||
      item.kind !== wording.kind
    ) {
      await store.quoteScopeItem.update({ where: { id: item.id }, data: wording });
    }
  }
}

/** Finish: validates, gives the number, and freezes the content, wording and recipient. */
export async function issueQuote(
  store: QuoteStore,
  actor: Actor,
  id: string,
): Promise<{ id: string; reference: string }> {
  assertRole(actor, MANAGEMENT);
  if ((await findQuote(store, id)).status !== "DRAFT") {
    throw new DomainError("Only a draft can be issued.");
  }
  await lockQuote(store, id);
  const quote = await findQuote(store, id);
  if (quote.status !== "DRAFT") throw new DomainError("Only a draft can be issued.");

  const { property } = await requireQuotable(store, quote.customerId, quote.propertyId);
  await refreshScope(store, quote);
  const scope = await store.quoteScopeItem.findMany({
    where: { quoteId: id },
    orderBy: { sortOrder: "asc" },
  });
  const validUntil = toDateString(quote.validUntil);
  const problems = validateForIssue({ validUntil, scope, lines: quote.lines }, todaySA());
  if (problems.length > 0) throw new QuoteIssueError(problems);

  const contacts = await store.contact.findMany({
    where: { customerId: quote.customerId },
    orderBy: { createdAt: "asc" },
  });
  const contact = contacts.find((c) => c.receivesQuotes) ?? contacts[0];
  if (!contact) throw new DomainError("This customer has no contact to address the quote to.");

  let numberYear: number | null;
  let numberSeq: number | null;
  if (quote.revisionOfId) {
    const source = await store.quote.findUniqueOrThrow({
      where: { id: quote.revisionOfId },
      select: { numberYear: true, numberSeq: true },
    });
    ({ numberYear, numberSeq } = source);
  } else {
    numberYear = yearSA();
    numberSeq = await allocateQuoteNumber(store, numberYear);
  }
  if (numberYear === null || numberSeq === null) {
    throw new DomainError("The quote this revises has no number.");
  }

  const siteAddress = [property.addressLine1, property.addressLine2, property.suburb, property.city]
    .filter(Boolean)
    .join(", ");

  const org = await store.organisationSettings.findUniqueOrThrow({ where: { id: "singleton" } });
  const snapshot = snapshotWording(await readQuoteWording(store), quote.lines, org);
  const recipient = { name: contact.name, email: contact.email, phone: contact.phone };
  const hash = contentHash({
    reference: { year: numberYear, seq: numberSeq, revision: quote.revision },
    validUntil,
    recipient,
    site: { label: property.label, address: siteAddress },
    scope: scope.map((s) => ({
      serviceId: s.serviceId,
      name: s.name,
      description: s.description,
      kind: s.kind,
      included: s.included,
    })),
    lines: quote.lines.map((l) => ({
      lineKind: l.lineKind,
      billing: l.billing,
      frequency: l.frequency,
      description: l.description,
      amountCents: l.amountCents,
    })),
    wording: snapshot,
  });

  await store.quote.update({
    where: { id },
    data: {
      status: "ISSUED",
      numberYear,
      numberSeq,
      issuedAt: new Date(),
      issuedById: actor.id,
      recipientName: recipient.name,
      recipientEmail: recipient.email,
      recipientPhone: recipient.phone,
      siteLabel: property.label,
      siteAddress,
      wordingSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      contentHash: hash,
    },
  });

  if (quote.revisionOfId) {
    // Only a quote that is still ISSUED becomes REPLACED; accepted, declined or withdrawn ones stay.
    const replaced = await store.quote.updateMany({
      where: { id: quote.revisionOfId, status: "ISSUED" },
      data: { status: "REPLACED" },
    });
    if (replaced.count === 1) {
      await logQuoteEvent(store, actor, "quote.replaced", quote.revisionOfId);
    }
  }
  await logQuoteEvent(store, actor, "quote.issued", id, { revision: quote.revision });
  return {
    id,
    reference: formatQuoteReference({ numberYear, numberSeq, revision: quote.revision }) ?? "",
  };
}

/** Copies an issued, accepted or declined quote into a new draft that revises it. */
export async function reviseQuote(
  store: QuoteStore,
  actor: Actor,
  id: string,
): Promise<{ id: string }> {
  assertRole(actor, MANAGEMENT);
  const allowed = ["ISSUED", "ACCEPTED", "DECLINED"];
  if (!allowed.includes((await findQuote(store, id)).status)) {
    throw new DomainError("This quote cannot be revised.");
  }
  await lockQuote(store, id);
  const source = await findQuote(store, id);
  if (!allowed.includes(source.status)) throw new DomainError("This quote cannot be revised.");
  // One open revision draft per number chain, so two drafts can never claim the same revision number.
  const open = await store.quote.findFirst({
    where: {
      status: "DRAFT",
      OR: [
        { revisionOfId: id },
        { revisionOf: { numberYear: source.numberYear, numberSeq: source.numberSeq } },
      ],
    },
    select: { id: true },
  });
  if (open) throw new DomainError("There is already a draft revision of this quote.");

  const latest = await store.quote.aggregate({
    where: { numberYear: source.numberYear, numberSeq: source.numberSeq },
    _max: { revision: true },
  });
  const wording = await readQuoteWording(store);
  const created = await store.quote.create({
    data: {
      customerId: source.customerId,
      propertyId: source.propertyId,
      createdById: actor.id,
      revisionOfId: source.id,
      revision: (latest._max.revision ?? source.revision) + 1,
      validUntil: fromDateString(addDays(todaySA(), wording.defaultValidityDays)),
      internalNote: source.internalNote,
      scopeItems: {
        create: source.scopeItems.map((s) => ({
          serviceId: s.serviceId,
          sortOrder: s.sortOrder,
          included: s.included,
          name: s.name,
          description: s.description,
          kind: s.kind,
        })),
      },
      lines: {
        create: source.lines.map((l) => ({
          sortOrder: l.sortOrder,
          lineKind: l.lineKind,
          billing: l.billing,
          frequency: l.frequency,
          description: l.description,
          amountCents: l.amountCents,
        })),
      },
    },
    select: { id: true },
  });
  await logQuoteEvent(store, actor, "quote.revised", created.id, { from: source.id });
  return created;
}

export async function withdrawQuote(store: QuoteStore, actor: Actor, id: string): Promise<void> {
  assertRole(actor, MANAGEMENT);
  if ((await findQuote(store, id)).status !== "ISSUED") {
    throw new DomainError("Only an issued quote can be withdrawn.");
  }
  await lockQuote(store, id);
  if ((await findQuote(store, id)).status !== "ISSUED") {
    throw new DomainError("Only an issued quote can be withdrawn.");
  }
  await store.quote.update({
    where: { id },
    data: { status: "WITHDRAWN", withdrawnAt: new Date() },
  });
  await logQuoteEvent(store, actor, "quote.withdrawn", id);
}

/** Records that staff shared the quote (copy and paste, or the PDF). Nothing is sent by the app. */
export async function markSent(
  store: QuoteStore,
  actor: Actor,
  id: string,
  method: SentMethod,
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  if ((await findQuote(store, id)).status !== "ISSUED") {
    throw new DomainError("Only an issued quote can be marked as sent.");
  }
  await lockQuote(store, id);
  if ((await findQuote(store, id)).status !== "ISSUED") {
    throw new DomainError("Only an issued quote can be marked as sent.");
  }
  await store.quote.update({ where: { id }, data: { sentAt: new Date(), sentMethod: method } });
  await logQuoteEvent(store, actor, "quote.sent", id, { method });
}
