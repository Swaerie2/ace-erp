import { checkRateLimit, getPortalDb, getPublicQuote } from "@ace/core";
import { QuotePdf } from "@ace/ui/quote-pdf";
import { renderToBuffer } from "@react-pdf/renderer";
import { getVisitor } from "@/lib/visitor";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const visitor = await getVisitor();
  const db = getPortalDb();
  // A route can answer with a real 429 (a page cannot).
  if (!(await checkRateLimit(db, "view", visitor.ipHash)).allowed) {
    return new Response("Too many requests. Please try again in a few minutes.", {
      status: 429,
      headers: { ...NO_STORE, "Retry-After": "600" },
    });
  }
  const quote = await getPublicQuote(db, token);
  // Issued (open or expired), accepted and declined quotes only; anything else is the same 404.
  const allowed = ["OPEN", "EXPIRED", "ACCEPTED", "DECLINED"];
  if (!quote.found || !allowed.includes(quote.state)) {
    return new Response("Not found", { status: 404, headers: NO_STORE });
  }
  // Called as a function so the element is typed as the Document renderToBuffer expects (QuotePdf stays hook-free).
  const buffer = await renderToBuffer(QuotePdf({ doc: quote.doc }));
  const filename = `${quote.reference.replaceAll(" ", "-")}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
