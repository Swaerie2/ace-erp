import { formatCentsForInput } from "@ace/core/client";
import {
  displayStatus,
  formatCustomerNumber,
  formatQuoteReference,
  formatZAR,
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
import { first } from "@/lib/search-params";
import { deleteDraftAction } from "../actions";
import { QuoteStatusBadge } from "../status-badge";
import { ActionPanel } from "./action-panel";
import { QuoteBuilder } from "./builder";
import type { BuilderInitial } from "./builder-types";
import { loadDocument } from "./document-input";
import { QuoteHistory } from "./history";
import { QuoteDocumentView } from "./quote-document";
import { QuoteFacts } from "./quote-facts";

const NOTICES: Record<string, string> = {
  paused: "Accepted. The customer is paused, so they were not made active. Check the customer.",
  archived: "Accepted. The customer is archived and was left unchanged. Check the customer.",
  cannot:
    "That could not be done. The quote may have changed. Check its status below and try again.",
};

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const staff = await requireStaff(["OWNER", "MANAGER"]); // every page starts with this
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = await toActor(staff);
  const quote = await getQuote(getDb(), actor, id);
  if (!quote) notFound();

  if (quote.status === "DRAFT" && quote.customer.anonymisedAt) {
    // The customer's details were wiped, so this draft is never opened for editing again.
    return (
      <div className="mx-auto max-w-3xl">
        <Link
          href="/quotes"
          className="inline-flex min-h-10 items-center text-sm text-forest hover:underline"
        >
          ← Quotes
        </Link>
        <h1 className="mt-2 font-display text-2xl font-semibold text-forest">Draft quote</h1>
        <p className="mt-3 rounded-lg bg-ochre/10 px-3 py-2 text-sm text-charcoal ring-1 ring-ochre/30">
          This customer has been anonymised, so this draft can no longer be edited.
        </p>
        <form action={deleteDraftAction} className="mt-6">
          <input type="hidden" name="id" value={quote.id} />
          <button type="submit" className="min-h-10 text-sm font-semibold text-red-700 underline">
            Delete this draft
          </button>
        </form>
      </div>
    );
  }
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
  const sp = await searchParams;
  const notice = first(sp.notice);
  const optionalLines = quote.lines
    .filter((l) => l.lineKind === "OPTIONAL")
    .map((l) => ({ id: l.id, label: `${l.description} (${formatZAR(l.amountCents ?? 0)})` }));
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

      {notice && Object.hasOwn(NOTICES, notice) ? (
        <p
          role="status"
          className="mt-4 rounded-lg bg-ochre/10 px-3 py-2 text-sm text-charcoal ring-1 ring-ochre/30"
        >
          {NOTICES[notice]}
        </p>
      ) : null}
      <div className="mt-4 space-y-3">
        <QuoteFacts quote={quote} />
        <ActionPanel
          id={quote.id}
          status={displayStatus(quote)}
          isOwner={staff.role === "OWNER"}
          recipientName={doc.preparedFor.name}
          optionalLines={optionalLines}
          today={todaySA()}
        />
      </div>

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
