import { getPortalDb, todaySA } from "@ace/core";
import { getPortalQuote } from "@ace/core/portal";
import { QuoteDocumentView } from "@ace/ui/quote-document";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Contact, Notice } from "@/components/notices";
import { AcceptForm } from "@/components/quote-forms/accept-form";
import { DeclineForm } from "@/components/quote-forms/decline-form";
import { AcceptedNotice, PdfLink } from "@/components/quote-outcome";
import { SignedInShell } from "@/components/signed-in-shell";
import { logoSrc as readLogoSrc } from "@/lib/logo";
import { requireSession } from "@/lib/session";
import { acceptPortalQuoteAction, declinePortalQuoteAction } from "./actions";

// Titles and descriptions never hold customer details.
export const metadata: Metadata = {
  title: "Your quotation from ACE Garden Services",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function PortalQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  // The scope is enforced inside the query: a quote of another customer is simply not found.
  const quote = await getPortalQuote(getPortalDb(), session.scope, id);
  if (!quote) notFound();

  const pdfHref = `/quotes/${encodeURIComponent(quote.id)}/pdf`;
  const logoSrc = await readLogoSrc();
  const contact = <Contact phone={quote.business.phone} email={quote.business.email} />;
  const back = (
    <Link
      href="/"
      prefetch={false}
      className="inline-flex min-h-10 items-center text-sm font-semibold text-forest underline"
    >
      Back to your quotes
    </Link>
  );

  switch (quote.state) {
    case "ACCEPTED":
      return (
        <SignedInShell>
          {back}
          <AcceptedNotice acceptance={quote.acceptance} pdfHref={pdfHref} />
          <QuoteDocumentView doc={quote.doc} logoSrc={logoSrc} />
        </SignedInShell>
      );
    case "DECLINED":
      return (
        <SignedInShell>
          {back}
          <Notice title="This quotation was declined">
            {quote.declinedAt ? <p>Declined on {quote.declinedAt}.</p> : null}
            {contact}
          </Notice>
          <p>
            <PdfLink href={pdfHref} />
          </p>
          <QuoteDocumentView doc={quote.doc} logoSrc={logoSrc} />
        </SignedInShell>
      );
    case "EXPIRED":
      return (
        <SignedInShell>
          {back}
          <Notice title="This quotation has expired">
            <p>Please contact ACE Garden Services.</p>
            {contact}
          </Notice>
          <QuoteDocumentView doc={quote.doc} logoSrc={logoSrc} />
        </SignedInShell>
      );
    case "OPEN":
      return (
        <SignedInShell>
          {back}
          <QuoteDocumentView doc={quote.doc} logoSrc={logoSrc} />
          <p>
            <PdfLink href={pdfHref} />
          </p>
          <AcceptForm
            action={acceptPortalQuoteAction.bind(null, quote.id)}
            reference={quote.reference}
            optionalLines={quote.optionalLines}
            today={todaySA()}
          />
          <DeclineForm action={declinePortalQuoteAction.bind(null, quote.id)} />
        </SignedInShell>
      );
    default:
      notFound();
  }
}
