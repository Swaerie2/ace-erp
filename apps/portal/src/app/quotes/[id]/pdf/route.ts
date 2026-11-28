import { checkRateLimit, getPortalDb } from "@ace/core";
import { getPortalQuote, needsWelcome } from "@ace/core/portal";
import { renderQuotePdf } from "@/lib/logo";
import { getSession } from "@/lib/session";
import { getVisitor } from "@/lib/visitor";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
const notFound = () => new Response("Not found", { status: 404, headers: NO_STORE });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const visitor = await getVisitor();
  // Link previews, crawlers and clients with no browser string get nothing, and use up no allowance.
  if (visitor.isBot) return notFound();
  const db = getPortalDb();
  // A route can answer with a real 429 (a page cannot).
  if (!(await checkRateLimit(db, "view", visitor.ipHash)).allowed) {
    return new Response("Too many requests. Please try again in a few minutes.", {
      status: 429,
      headers: { ...NO_STORE, "Retry-After": "600" },
    });
  }
  // A route cannot redirect to a page: not signed in, or not yet welcomed, is the same 404.
  const session = await getSession();
  if (!session || needsWelcome(session.scope)) return notFound();
  // The scope is enforced inside the query: a quote that is not the person's is the same 404.
  const quote = await getPortalQuote(db, session.scope, id);
  if (!quote) return notFound();
  // With the company logo when there is one; a bad logo falls back to a PDF without it.
  const bytes = await renderQuotePdf(quote.doc);
  const filename = `${quote.reference.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
  return new Response(bytes, {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
