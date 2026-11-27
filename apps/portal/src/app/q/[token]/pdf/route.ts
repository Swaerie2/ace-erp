import { checkRateLimit, getPortalDb, getPublicQuote } from "@ace/core";
import { renderQuotePdf } from "@/lib/logo";
import { getVisitor } from "@/lib/visitor";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const visitor = await getVisitor();
  // Link previews, crawlers and clients with no browser string get no quote data from any route.
  // Checked before the rate limit so they do not use up allowance.
  if (visitor.isBot) return new Response("Not found", { status: 404, headers: NO_STORE });
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
  // With the company logo when there is one; a bad logo falls back to a PDF without it.
  const bytes = await renderQuotePdf(quote.doc);
  const filename = `${quote.reference.replaceAll(" ", "-")}.pdf`;
  return new Response(bytes, {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
