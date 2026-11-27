import "server-only";
import {
  getDb,
  getLogoForPdf,
  type Actor,
  type InvoiceDocument,
  type PdfLogo,
  type StatementDocument,
} from "@ace/core";
import { InvoicePdf, StatementPdf } from "@ace/ui/invoice-pdf";
import { renderToBuffer } from "@react-pdf/renderer";

// Called as functions (not createElement) so the element is typed as the Document renderToBuffer expects;
// the layouts must stay hook-free.
export async function renderInvoicePdf(
  doc: InvoiceDocument,
  logo?: PdfLogo | null,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await renderToBuffer(InvoicePdf({ doc, logo })));
}

export async function renderStatementPdf(
  doc: StatementDocument,
  logo?: PdfLogo | null,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await renderToBuffer(StatementPdf({ doc, logo })));
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
