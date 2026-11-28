import "server-only";
import {
  getCompanyProfile,
  getDb,
  getLogoForPdf,
  type Actor,
  type InvoiceDocument,
  type PdfLogo,
  type QuoteDocument,
  type StatementDocument,
} from "@ace/core";
import { InvoicePdf, StatementPdf } from "@ace/ui/invoice-pdf";
import { QuotePdf } from "@ace/ui/quote-pdf";
import { renderToBuffer } from "@react-pdf/renderer";

/**
 * Renders with the logo, and if that fails, once more without it: a PDF must never fail because of a bad
 * logo. Only fixed words are logged (never the error or the picture). A failure without a logo is thrown.
 */
async function withLogoFallback(
  logo: PdfLogo | null | undefined,
  render: (logo: PdfLogo | null) => Promise<Buffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (logo) {
    try {
      return new Uint8Array(await render(logo));
    } catch {
      console.error("The company logo could not be drawn, so the PDF was made without it.");
    }
  }
  return new Uint8Array(await render(null));
}

// Called as functions (not createElement) so the element is typed as the Document renderToBuffer expects;
// the layouts must stay hook-free.
export async function renderInvoicePdf(
  doc: InvoiceDocument,
  logo?: PdfLogo | null,
): Promise<Uint8Array<ArrayBuffer>> {
  return withLogoFallback(logo, (l) => renderToBuffer(InvoicePdf({ doc, logo: l })));
}

export async function renderStatementPdf(
  doc: StatementDocument,
  logo?: PdfLogo | null,
): Promise<Uint8Array<ArrayBuffer>> {
  return withLogoFallback(logo, (l) => renderToBuffer(StatementPdf({ doc, logo: l })));
}

export async function renderQuotePdf(
  doc: QuoteDocument,
  logo?: PdfLogo | null,
): Promise<Uint8Array<ArrayBuffer>> {
  return withLogoFallback(logo, (l) => renderToBuffer(QuotePdf({ doc, logo: l })));
}

/**
 * The company logo for a PDF, read once per request. A problem reading it must never break a PDF: the PDF is
 * then made without the logo, and only fixed words are logged (never the error).
 */
export async function logoForPdf(actor: Actor): Promise<PdfLogo | null> {
  try {
    return await getLogoForPdf(getDb(), actor);
  } catch {
    console.error("The company logo could not be read, so the PDF was made without it.");
    return null;
  }
}

/**
 * The address of the logo for a document screen (`/company-logo?v=<version>`), or null when there is no
 * logo. The version changes with every upload, so the long browser cache never shows an old picture. A
 * problem reading it never breaks the page: it is then shown without the logo, and only fixed words are
 * logged (never the error).
 */
export async function logoSrcFor(actor: Actor): Promise<string | null> {
  try {
    const { logo } = await getCompanyProfile(getDb(), actor);
    return logo ? `/company-logo?v=${encodeURIComponent(logo.version)}` : null;
  } catch {
    console.error("The company logo could not be checked, so the page was shown without it.");
    return null;
  }
}
