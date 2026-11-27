import { getDb, invoicePdfFilename, loadInvoiceDocument } from "@ace/core";
import { z } from "zod";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { logoForPdf, renderInvoicePdf } from "@/lib/invoice-pdf";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(["OWNER", "MANAGER"]); // every route starts with this
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const actor = await toActor(staff);
  const loaded = await loadInvoiceDocument(getDb(), actor, id);
  if (!loaded) return new Response("Not found", { status: 404 });
  const bytes = await renderInvoicePdf(loaded.doc, await logoForPdf(actor));
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoicePdfFilename(loaded.doc.reference)}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
