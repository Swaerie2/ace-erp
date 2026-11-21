import { recordAudit, staffParty, type AuditParty } from "../audit";
import { DomainError, type Actor } from "../customers/access";
import type { Db } from "../db";
import type { Prisma } from "../generated/prisma/client";

/** What the quote functions need. Works with the normal connection or a transaction. */
export type QuoteStore = Pick<
  Db,
  | "quote"
  | "quoteScopeItem"
  | "quoteLine"
  | "quoteWording"
  | "quoteCounter"
  | "service"
  | "customer"
  | "contact"
  | "property"
  | "auditLog"
  | "organisationSettings"
  | "staffUser"
  | "$queryRaw"
>;

/** Two people saved the same draft; the later one must reload instead of overwriting. */
export class DraftConflictError extends DomainError {
  constructor() {
    super("This quote was changed somewhere else. Reload the page to see the latest version.");
    this.name = "DraftConflictError";
  }
}

export const QUOTE_INCLUDE = {
  scopeItems: { orderBy: { sortOrder: "asc" } },
  lines: { orderBy: { sortOrder: "asc" } },
} as const satisfies Prisma.QuoteInclude;

export async function findQuote(store: QuoteStore, id: string) {
  const quote = await store.quote.findUnique({ where: { id }, include: QUOTE_INCLUDE });
  if (!quote) throw new DomainError("That quote could not be found.");
  return quote;
}

/**
 * Locks the quote row until the transaction ends, by touching it, so two people changing the same
 * quote take turns. Call it only when something is really about to be written.
 */
export async function lockQuote(store: Pick<Db, "quote">, id: string): Promise<void> {
  const { count } = await store.quote.updateMany({
    where: { id },
    data: { updatedAt: new Date() },
  });
  if (count !== 1) throw new DomainError("That quote could not be found.");
}

/** The customer and property a quote may be written for. */
export async function requireQuotable(store: QuoteStore, customerId: string, propertyId: string) {
  const customer = await store.customer.findUnique({
    where: { id: customerId },
    select: { id: true, status: true, anonymisedAt: true },
  });
  if (!customer) throw new DomainError("That customer could not be found.");
  if (customer.anonymisedAt) {
    throw new DomainError("This customer has been anonymised and cannot be quoted.");
  }
  if (customer.status === "ARCHIVED")
    throw new DomainError("Restore this customer before quoting.");
  const property = await store.property.findUnique({ where: { id: propertyId } });
  if (!property || property.customerId !== customerId || property.archivedAt) {
    throw new DomainError("Choose one of this customer's properties.");
  }
  return { customer, property };
}

/** Writes an audit line about a quote for any acting party. `after` holds field names, ids and fixed words only. */
export async function logQuoteEventAs(
  store: Pick<QuoteStore, "auditLog">,
  party: AuditParty,
  action: string,
  quoteId: string,
  after?: Prisma.InputJsonValue,
): Promise<void> {
  await recordAudit(store, {
    actorType: party.actorType,
    ...(party.actorId ? { actorId: party.actorId } : {}),
    action,
    entityType: "quote",
    entityId: quoteId,
    ...(after !== undefined ? { after } : {}),
    ...(party.ip ? { ip: party.ip } : {}),
    ...(party.userAgent ? { userAgent: party.userAgent } : {}),
  });
}

/** Writes an audit line about a quote. `after` holds field names, ids and fixed words only. */
export async function logQuoteEvent(
  store: QuoteStore,
  actor: Actor,
  action: string,
  quoteId: string,
  after?: Prisma.InputJsonValue,
): Promise<void> {
  await logQuoteEventAs(store, staffParty(actor), action, quoteId, after);
}
