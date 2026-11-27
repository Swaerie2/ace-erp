import { getDb, getQuote } from "@ace/core";
import { z } from "zod";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { logoForPdf, renderQuotePdf } from "@/lib/invoice-pdf";
import { loadDocument } from "../document-input";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(["OWNER", "MANAGER"]); // every route starts with this
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const actor = await toActor(staff);
  const quote = await getQuote(getDb(), actor, id);
  // A draft has no number and is not a document yet.
  if (!quote || quote.status === "DRAFT") return new Response("Not found", { status: 404 });

  const { doc } = await loadDocument(quote, actor);
  // Made with the logo when there is one; a bad logo falls back to a PDF without it.
  const bytes = await renderQuotePdf(doc, await logoForPdf(actor));
  const filename = `${doc.reference.replaceAll(" ", "-")}.pdf`;
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
