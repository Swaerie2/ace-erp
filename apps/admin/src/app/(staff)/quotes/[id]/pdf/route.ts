import { getDb, getQuote } from "@ace/core";
import { renderToBuffer } from "@react-pdf/renderer";
import { z } from "zod";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { loadDocument } from "../document-input";
import { QuotePdf } from "@ace/ui/quote-pdf";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(["OWNER", "MANAGER"]); // every route starts with this
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const actor = await toActor(staff);
  const quote = await getQuote(getDb(), actor, id);
  // A draft has no number and is not a document yet.
  if (!quote || quote.status === "DRAFT") return new Response("Not found", { status: 404 });

  const { doc } = await loadDocument(quote, actor);
  // Called as a function (not createElement) so the element is typed as the Document that
  // renderToBuffer expects. That means QuotePdf must stay hook-free (it runs outside a React
  // render) and must return the <Document> element as its root.
  const buffer = await renderToBuffer(QuotePdf({ doc }));
  const filename = `${doc.reference.replaceAll(" ", "-")}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
