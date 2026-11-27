import {
  defaultStatementPeriod,
  getDb,
  loadStatementDocument,
  statementPdfFilename,
  statementPeriodProblem,
  todaySA,
} from "@ace/core";
import { z } from "zod";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { logoForPdf, renderStatementPdf } from "@/lib/invoice-pdf";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ customerId: string }> },
) {
  const staff = await requireStaff(["OWNER", "MANAGER"]); // every route starts with this
  const { customerId } = await params;
  if (!z.uuid().safeParse(customerId).success) return new Response("Not found", { status: 404 });
  const search = new URL(request.url).searchParams;
  const fallback = defaultStatementPeriod(todaySA());
  const period = { from: search.get("from") ?? fallback.from, to: search.get("to") ?? fallback.to };
  if (statementPeriodProblem(period.from, period.to))
    return new Response("Not found", { status: 404 });
  const actor = await toActor(staff);
  const loaded = await loadStatementDocument(getDb(), actor, customerId, period);
  if (!loaded) return new Response("Not found", { status: 404 });
  const bytes = await renderStatementPdf(loaded.doc, await logoForPdf(actor));
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${statementPdfFilename(loaded.doc.customer.number, period.to)}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
