import "server-only";
import {
  buildQuoteDocument,
  displayStatus,
  formatQuoteReference,
  getCustomer,
  getDb,
  getQuoteWording,
  snapshotWording,
  wordingSnapshotSchema,
  type Actor,
  type getQuote,
} from "@ace/core";
import { formatDate } from "@/lib/format";

type Quote = NonNullable<Awaited<ReturnType<typeof getQuote>>>;

/**
 * Builds the document for a stored quote. An issued (or later) quote uses its frozen recipient and
 * wording; a draft is built from the live customer, property and standard wording.
 */
export async function loadDocument(quote: Quote, actor: Actor) {
  const frozen = quote.status !== "DRAFT";
  const lines = quote.lines.map((l) => ({
    id: l.id,
    lineKind: l.lineKind,
    billing: l.billing,
    frequency: l.frequency,
    description: l.description,
    amountCents: l.amountCents,
    chosen: l.chosen,
  }));
  const scope = quote.scopeItems.map((s) => ({
    name: s.name,
    description: s.description,
    kind: s.kind,
    included: s.included,
  }));

  let wording;
  let preparedFor;
  if (frozen) {
    wording = wordingSnapshotSchema.parse(quote.wordingSnapshot);
    preparedFor = {
      name: quote.recipientName ?? "Anonymised customer",
      email: quote.recipientEmail,
      phone: quote.recipientPhone,
      siteLabel: quote.siteLabel ?? "",
      siteAddress: quote.siteAddress ?? "",
    };
  } else {
    const db = getDb();
    const org = await db.organisationSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    wording = snapshotWording(await getQuoteWording(db, actor), lines, org);
    const customer = await getCustomer(db, actor, quote.customerId);
    const contact =
      customer?.contacts.find((c) => c.receivesQuotes) ?? customer?.contacts[0] ?? null;
    preparedFor = {
      name: contact?.name ?? quote.customer.displayName,
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
      siteLabel: quote.property.label,
      siteAddress: [
        quote.property.addressLine1,
        quote.property.addressLine2,
        quote.property.suburb,
        quote.property.city,
      ]
        .filter(Boolean)
        .join(", "),
    };
  }

  const doc = buildQuoteDocument({
    status: displayStatus(quote),
    reference: formatQuoteReference(quote),
    issuedDate: quote.issuedAt ? formatDate(quote.issuedAt) : null,
    validUntil: formatDate(quote.validUntil),
    preparedFor,
    scope,
    lines,
    wording,
  });
  return { doc, frozen };
}
