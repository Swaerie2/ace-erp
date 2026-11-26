import { checkRateLimit, getPortalDb, getPublicQuote, recordLinkView, todaySA } from "@ace/core";
import { QuoteDocumentView } from "@ace/ui/quote-document";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarePage, Contact, Notice, PageShell, TooManyRequests } from "@/components/notices";
import { AcceptForm } from "@/components/quote-forms/accept-form";
import { DeclineForm } from "@/components/quote-forms/decline-form";
import { AcceptedNotice, PdfLink } from "@/components/quote-outcome";
import { getVisitor } from "@/lib/visitor";
import { acceptAction, declineAction } from "./actions";

// Titles and descriptions never hold customer details.
export const metadata: Metadata = {
  title: "Your quotation from ACE Garden Services",
  description: "A private quotation from ACE Garden Services.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function QuoteLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const visitor = await getVisitor();
  // Link previews, crawlers and clients with no browser string: no quote data is read and no view is recorded.
  if (visitor.isBot) return <BarePage />;

  const db = getPortalDb();
  // A page cannot answer with HTTP 429, so over the limit the visitor sees a plain notice instead.
  if (!(await checkRateLimit(db, "view", visitor.ipHash)).allowed) return <TooManyRequests />;

  const quote = await getPublicQuote(db, token);
  if (!quote.found) notFound(); // the same page for wrong, revoked, malformed and draft codes
  await recordLinkView(db, token);

  const pdfHref = `/q/${encodeURIComponent(token)}/pdf`;
  const contact = <Contact phone={quote.business.phone} email={quote.business.email} />;

  switch (quote.state) {
    case "WITHDRAWN":
      return (
        <PageShell>
          <Notice title="This quotation has been withdrawn">{contact}</Notice>
        </PageShell>
      );
    case "REPLACED":
      return (
        <PageShell>
          <Notice title="This quotation has been replaced by a newer version">
            {quote.newerToken ? (
              <Link
                href={`/q/${encodeURIComponent(quote.newerToken)}`}
                prefetch={false}
                className="mt-2 inline-flex min-h-11 items-center rounded-full bg-forest px-6 py-2.5 font-display text-sm font-semibold text-cream hover:bg-forest-deep"
              >
                View the newer quotation
              </Link>
            ) : (
              contact
            )}
          </Notice>
        </PageShell>
      );
    case "DECLINED":
      return (
        <PageShell>
          <Notice title="This quotation was declined">{contact}</Notice>
        </PageShell>
      );
    case "ACCEPTED":
      return (
        <PageShell>
          <AcceptedNotice acceptance={quote.acceptance} pdfHref={pdfHref} />
          <QuoteDocumentView doc={quote.doc} />
        </PageShell>
      );
    case "EXPIRED":
      return (
        <PageShell>
          <Notice title="This quotation has expired">
            <p>Please contact ACE Garden Services.</p>
            {contact}
          </Notice>
          <QuoteDocumentView doc={quote.doc} />
        </PageShell>
      );
    case "OPEN":
      return (
        <PageShell>
          <QuoteDocumentView doc={quote.doc} />
          <p>
            <PdfLink href={pdfHref} />
          </p>
          <AcceptForm
            action={acceptAction.bind(null, token)}
            reference={quote.reference}
            optionalLines={quote.optionalLines}
            today={todaySA()}
          />
          <DeclineForm action={declineAction.bind(null, token)} />
        </PageShell>
      );
  }
}
