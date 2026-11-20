import { formatCentsForInput } from "@ace/core/client";
import {
  displayStatus,
  formatCustomerNumber,
  formatQuoteReference,
  getDb,
  getQuote,
  getQuoteWording,
  listQuoteActivity,
  todaySA,
} from "@ace/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { QuoteStatusBadge } from "../status-badge";
import { QuoteBuilder } from "./builder";
import type { BuilderInitial } from "./builder-types";
import { loadDocument } from "./document-input";
import { QuoteHistory } from "./history";
import { QuoteDocumentView } from "./quote-document";

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(["OWNER", "MANAGER"]); // every page starts with this
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = await toActor(staff);
  const quote = await getQuote(getDb(), actor, id);
  if (!quote) notFound();
  const { doc } = await loadDocument(quote, actor);

  if (quote.status === "DRAFT") {
    const db = getDb();
    const org = await db.organisationSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    const { updatedAt, ...wording } = await getQuoteWording(db, actor);
    void updatedAt;
    const revisionOf = quote.revisionOfId ? await getQuote(db, actor, quote.revisionOfId) : null;
    const initial: BuilderInitial = {
      id: quote.id,
      version: quote.draftVersion,
      state: {
        scope: quote.scopeItems.map((s) => ({
          serviceId: s.serviceId,
          name: s.name,
          description: s.description,
          kind: s.kind,
          included: s.included,
        })),
        lines: quote.lines.map((l) => ({
          key: l.id,
          lineKind: l.lineKind,
          billing: l.billing,
          frequency: l.frequency,
          description: l.description,
          amountText: l.amountCents === null ? "" : formatCentsForInput(l.amountCents),
        })),
        validUntil: quote.validUntil.toISOString().slice(0, 10),
        internalNote: quote.internalNote ?? "",
      },
      revisionOfReference: revisionOf ? formatQuoteReference(revisionOf) : null,
      customerName: quote.customer.displayName,
      siteLabel: quote.property.label,
      property: {
        lawnSizeSqm: quote.property.lawnSizeSqm,
        accessNotes: quote.property.accessNotes,
      },
      preparedFor: doc.preparedFor,
      wording,
      org: { legalName: org.legalName, tradingName: org.tradingName, vatEnabled: org.vatEnabled },
      today: todaySA(),
    };
    return <QuoteBuilder initial={initial} />;
  }
  const history = await listQuoteActivity(getDb(), actor, id);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/quotes"
        className="inline-flex min-h-10 items-center text-sm text-forest hover:underline"
      >
        ← Quotes
      </Link>
      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-2xl font-semibold text-forest">{doc.reference}</h1>
        <QuoteStatusBadge status={displayStatus(quote)} />
      </div>
      <p className="mt-1 text-charcoal">
        <Link href={`/customers/${quote.customer.id}`} className="text-forest underline">
          {quote.customer.displayName}
        </Link>{" "}
        <span className="text-sm text-charcoal/50">
          {formatCustomerNumber(quote.customer.number)}
        </span>
      </p>

      <div className="mt-6">
        <QuoteDocumentView doc={doc} />
      </div>

      <h2 className="mt-10 font-display text-lg font-semibold text-forest">History</h2>
      <div className="mt-3">
        <QuoteHistory entries={history} />
      </div>
    </div>
  );
}
