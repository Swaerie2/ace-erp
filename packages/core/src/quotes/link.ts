import { assertRole, DomainError, MANAGEMENT, type Actor } from "../customers/access";
import { findEditableCustomer } from "../customers/store";
import { findQuote, lockQuote, logQuoteEvent, type QuoteStore } from "./store";
import { generateLinkToken } from "./token";

const LINKABLE = ["ISSUED", "ACCEPTED", "DECLINED"];
const NOT_LINKABLE = "A link can only be made for an issued, accepted or declined quote.";

/**
 * Creates the private client link for a quote (or returns the existing one). With `replace` a fresh code is
 * made and the old one stops working. The code is never written to the audit log.
 */
export async function createQuoteLink(
  store: QuoteStore,
  actor: Actor,
  id: string,
  opts: { replace?: boolean } = {},
): Promise<{ token: string }> {
  assertRole(actor, MANAGEMENT);
  const first = await findQuote(store, id);
  if (!LINKABLE.includes(first.status)) throw new DomainError(NOT_LINKABLE);
  await findEditableCustomer(store, first.customerId);
  await lockQuote(store, id);
  const quote = await findQuote(store, id);
  if (!LINKABLE.includes(quote.status)) throw new DomainError(NOT_LINKABLE);
  if (quote.linkToken && !opts.replace) return { token: quote.linkToken };
  const token = generateLinkToken();
  await store.quote.update({
    where: { id },
    data: { linkToken: token, linkCreatedAt: new Date(), firstViewedAt: null, lastViewedAt: null },
    select: { id: true },
  });
  await logQuoteEvent(store, actor, "quote.link_created", id, {
    replaced: Boolean(quote.linkToken),
  });
  return { token };
}

/** Stops the private link working. Nothing happens if there is no link. */
export async function revokeQuoteLink(store: QuoteStore, actor: Actor, id: string): Promise<void> {
  assertRole(actor, MANAGEMENT);
  if (!(await findQuote(store, id)).linkToken) return;
  await lockQuote(store, id);
  if (!(await findQuote(store, id)).linkToken) return;
  await store.quote.update({
    where: { id },
    data: { linkToken: null },
    select: { id: true },
  });
  await logQuoteEvent(store, actor, "quote.link_revoked", id);
}
