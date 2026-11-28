import {
  formatDateSA,
  formatDateTimeSA,
  formatZAR,
  fromDateString,
  getDb,
  getInvoice,
  listPaymentReports,
  PAYMENT_REPORT_STATUS_LABELS,
  type InvoiceDisplayStatus,
} from "@ace/core";
import Link from "next/link";
import { secondaryButtonClass } from "@/components/form";
import { Notice, noticeFor, type NoticeText } from "@/components/notice";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { first } from "@/lib/search-params";
import { dismissReportAction } from "../../invoices/actions";
import { PendingButton } from "../../invoices/pending-button";
import { InvoiceStatusBadge } from "../../invoices/status-badge";

const NOTICES: Record<string, NoticeText> = {
  dismissed: { text: "Report dismissed.", ok: true },
  "report-resolved": { text: "That report has already been dealt with.", ok: false },
  cannot: {
    text: "That could not be done. The report may already have been dealt with.",
    ok: false,
  },
};

const linkClass = "inline-flex min-h-10 items-center text-sm text-forest hover:underline";

export default async function ReportedPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[]; notice?: string | string[] }>;
}) {
  const staff = await requireStaff(["OWNER", "MANAGER"]); // every page starts with this
  const sp = await searchParams;
  const actor = await toActor(staff);
  const db = getDb();
  const all = first(sp.show) === "all";
  const reports = await listPaymentReports(db, actor, { status: all ? "ALL" : "WAITING" });
  // The invoice's status now, for the reports still waiting: an invoice voided or paid since the report
  // can still be confirmed, and the money then becomes credit on account.
  const waitingInvoiceIds = [
    ...new Set(reports.filter((r) => r.status === "WAITING").map((r) => r.invoice.id)),
  ];
  const statuses = new Map<string, InvoiceDisplayStatus>();
  for (const inv of await Promise.all(waitingInvoiceIds.map((i) => getInvoice(db, actor, i)))) {
    if (inv) statuses.set(inv.id, inv.displayStatus);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/payments" className={linkClass}>
        ← Payments
      </Link>
      <h1 className="font-display text-2xl font-semibold text-forest">Reported payments</h1>
      <p className="text-sm text-charcoal/70">
        Clients will be able to tell ACE &quot;I have paid&quot; from the client portal. Check each
        one against the bank statement, then confirm it (this records the payment) or dismiss it.
      </p>
      <Notice notice={noticeFor(first(sp.notice), NOTICES)} />
      <Link
        href={all ? "/payments/reports" : "/payments/reports?show=all"}
        className={`${linkClass} underline`}
      >
        {all ? "Show waiting reports only" : "Show all reports"}
      </Link>
      {reports.length === 0 ? (
        <p className="text-charcoal/60">{all ? "No reports yet." : "No reports are waiting."}</p>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => {
            const status = statuses.get(r.invoice.id);
            const owesNothing = status === "VOID" || status === "PAID";
            return (
              <li
                key={r.id}
                className="space-y-2 rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10"
              >
                <p className="flex flex-wrap items-center gap-2 break-words text-sm">
                  <span className="min-w-0 break-words">
                    <Link
                      href={`/invoices/${r.invoice.id}`}
                      className="font-semibold text-forest underline"
                    >
                      {r.invoice.reference ?? "Invoice"}
                    </Link>{" "}
                    ({formatZAR(r.invoice.totalCents ?? 0)}) for {r.invoice.customer.displayName}
                    {r.invoice.billTo.id !== r.invoice.customer.id
                      ? `, billed to ${r.invoice.billTo.displayName}`
                      : ""}
                  </span>
                  {status ? <InvoiceStatusBadge status={status} /> : null}
                </p>
                <p className="break-words text-sm text-charcoal/70">
                  Paid on {formatDateSA(fromDateString(r.paidOn))}
                  {r.reference ? `, reference ${r.reference}` : ""}
                  {r.reportedBy ? `, reported by ${r.reportedBy}` : ""},{" "}
                  {formatDateTimeSA(r.createdAt)}. Report:{" "}
                  {PAYMENT_REPORT_STATUS_LABELS[r.status].toLowerCase()}.
                </p>
                {r.status === "WAITING" && owesNothing ? (
                  <p className="text-sm text-red-800">
                    {status === "VOID"
                      ? "This invoice has been voided since the report."
                      : "This invoice is already paid."}{" "}
                    Confirming records the money as credit on account unless you allocate it to
                    another invoice.
                  </p>
                ) : null}
                {r.status === "WAITING" ? (
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/payments/new?report=${r.id}`} className={secondaryButtonClass}>
                      Confirm
                    </Link>
                    <form action={dismissReportAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="back" value="reports" />
                      <PendingButton
                        label="Dismiss"
                        pendingLabel="Dismissing..."
                        className={secondaryButtonClass}
                      />
                    </form>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
