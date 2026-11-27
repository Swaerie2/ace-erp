import "server-only";
import { getPortalDb, type PdfLogo, type QuoteDocument } from "@ace/core";
import { getLogoForClientPdf, getLogoVersionForClient } from "@ace/core/portal";
import { QuotePdf } from "@ace/ui/quote-pdf";
import { renderToBuffer } from "@react-pdf/renderer";

/**
 * The company logo for a quote PDF. A problem reading it must never break a PDF: the PDF is then made
 * without the logo, and only fixed words are logged (never the error).
 */
export async function logoForPdf(): Promise<PdfLogo | null> {
  try {
    return await getLogoForClientPdf(getPortalDb());
  } catch {
    console.error("The company logo could not be read, so the PDF was made without it.");
    return null;
  }
}

/**
 * The address of the logo for a quote screen (`/company-logo?v=<version>`), or null when there is no logo
 * (or it could not be checked: the page then shows no logo rather than failing).
 */
export async function logoSrc(): Promise<string | null> {
  try {
    const version = await getLogoVersionForClient(getPortalDb());
    return version ? `/company-logo?v=${encodeURIComponent(version)}` : null;
  } catch {
    console.error("The company logo could not be checked, so the page was shown without it.");
    return null;
  }
}

/**
 * The quote PDF, with the logo when there is one. If drawing the logo fails it is made once more without
 * it: a PDF must never fail because of a bad logo. Called as a function (not createElement) so the element
 * is typed as the Document renderToBuffer expects; QuotePdf stays hook-free.
 */
export async function renderQuotePdf(doc: QuoteDocument): Promise<Uint8Array<ArrayBuffer>> {
  const logo = await logoForPdf();
  if (logo) {
    try {
      return new Uint8Array(await renderToBuffer(QuotePdf({ doc, logo })));
    } catch {
      console.error("The company logo could not be drawn, so the PDF was made without it.");
    }
  }
  return new Uint8Array(await renderToBuffer(QuotePdf({ doc })));
}
