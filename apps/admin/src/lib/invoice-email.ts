import "server-only";
import {
  emailIssuedInvoices,
  getDb,
  invoicePdfFilename,
  loadInvoiceDocument,
  sendEmail,
  type Actor,
} from "@ace/core";
import { after } from "next/server";
import { logoForPdf, renderInvoicePdf } from "@/lib/invoice-pdf";

/**
 * After an issue has committed: emails the invoices (grouped per payer, PDFs attached) once the response has
 * gone. An email problem never touches the issued invoices; it is noted on each invoice and in its history,
 * and staff can press Resend email.
 */
export function emailInvoicesLater(actor: Actor, invoiceIds: readonly string[]): void {
  if (invoiceIds.length === 0) return;
  const ids = [...invoiceIds];
  after(async () => {
    try {
      // Read once for the whole batch; a missing or unreadable logo just means plain PDFs.
      const logo = await logoForPdf(actor);
      await emailIssuedInvoices(getDb(), actor, ids, {
        send: (message) => sendEmail(message),
        // A failure here must throw: core then marks this invoice's email as failed.
        attachmentFor: async (id) => {
          const loaded = await loadInvoiceDocument(getDb(), actor, id);
          if (!loaded) throw new Error("Invoice not found.");
          return {
            filename: invoicePdfFilename(loaded.doc.reference),
            content: await renderInvoicePdf(loaded.doc, logo),
          };
        },
      });
    } catch {
      // Fixed words only: never the error (it may hold an address).
      console.error("Invoice emails could not be sent after an issue.");
    }
  });
}
