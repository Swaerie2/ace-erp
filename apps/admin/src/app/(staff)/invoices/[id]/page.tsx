import {
  DomainError,
  formatCentsForInput,
  formatCustomerNumber,
  formatDateSA,
  formatDateTimeSA,
  formatMonthLabel,
  formatZAR,
  fromDateString,
  getDb,
  getInvoice,
  INVOICE_ACTION_LABELS,
  invoiceSettingsStatus,
  listInvoiceActivity,
  loadInvoiceDocument,
  PAYMENT_REPORT_STATUS_LABELS,
} from "@ace/core";
import { InvoiceDocumentView } from "@ace/ui/invoice-document";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { dangerButtonClass, secondaryButtonClass } from "@/components/form";
import { Notice, noticeFor, type NoticeText } from "@/components/notice";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { first } from "@/lib/search-params";
import {
  deleteInvoiceDraftAction,
  dismissReportAction,
  resendInvoiceEmailAction,
} from "../actions";
import { InvoiceStatusBadge } from "../status-badge";
import { DraftForm } from "./draft-form";
import { IssueForm, VoidForm } from "./invoice-forms";

const NOTICES: Record<string, NoticeText> = {
  saved: { text: "Draft saved.", ok: true },
  issued: {
    text: "Issued. The email goes out in the background: refresh in a moment to see the result.",
    ok: true,
  },
  voided: { text: "Invoice voided.", ok: true },
  "email-queued": {
    text: "The email is being sent again. Refresh in a moment to see the result.",
    ok: true,
  },
  dismissed: { text: "Report dismissed.", ok: true },
  "report-resolved": { text: "That report has already been dealt with.", ok: false },
  archived: { text: "Restore this customer before invoicing.", ok: false },
  cannot: {
    text: "That could not be done. The invoice may have changed: check it below and try again.",
    ok: false,
  },
};

const day = (value: Date | string) =>
  formatDateSA(typeof value === "string" ? fromDateString(value) : value);
/** 125050 -> "1250.50", -5050 -> "-50.50" (for an edit box). */
const amountForInput = (cents: number) =>
  cents < 0 ? `-${formatCentsForInput(-cents)}` : formatCentsForInput(cents);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10">
      <h2 className="font-display text-lg font-semibold text-forest">{title}</h2>
      {children}
    </section>
  );
}

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const staff = await requireStaff(["OWNER", "MANAGER"]); // every page starts with this
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const actor = await toActor(staff);
  const db = getDb();
  const inv = await getInvoice(db, actor, id);
  if (!inv) notFound();
  const [loaded, history, settings] = await Promise.all([
    // A damaged issued invoice (its saved details unreadable) still shows the rest of the page.
    loadInvoiceDocument(db, actor, id).catch((error: unknown) => {
      if (error instanceof DomainError) return "damaged" as const;
      throw error;
    }),
    listInvoiceActivity(db, actor, id),
    invoiceSettingsStatus(db, actor),
  ]);
  const doc = loaded && loaded !== "damaged" ? loaded.doc : null;
  const anonymised = Boolean(inv.customer.anonymisedAt);
  const editable = inv.status === "DRAFT" && !anonymised;
  const waiting = inv.reports.filter((r) => r.status === "WAITING");
  const title =
    inv.reference ?? (inv.kind === "MONTHLY" ? "Draft monthly invoice" : "Draft invoice");
  // The payer as the document shows it: worked out again for a draft, frozen once issued.
  const payerName = doc?.billTo.name ?? inv.billTo.displayName;
  const billedElsewhere = inv.billTo.id !== inv.customer.id;
  const owing = inv.status === "ISSUED" && inv.balanceCents > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/invoices"
        className="inline-flex min-h-10 items-center text-sm text-forest hover:underline"
      >
        ← Invoices
      </Link>
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold text-forest">{title}</h1>
          <InvoiceStatusBadge status={inv.displayStatus} />
        </div>
        <p className="mt-1 break-words text-sm text-charcoal/70">
          For{" "}
          <Link
            href={`/customers/${inv.customer.id}?tab=invoices`}
            className="font-semibold text-forest underline"
          >
            {inv.customer.displayName}
          </Link>{" "}
          {formatCustomerNumber(inv.customer.number)}
          {billedElsewhere ? `. Billed to ${payerName}` : ""}
          {inv.serviceMonthString
            ? `. Service month ${formatMonthLabel(inv.serviceMonthString)}`
            : ""}
          {inv.sourceQuoteReference && inv.sourceQuoteId ? (
            <>
              . From quote{" "}
              <Link href={`/quotes/${inv.sourceQuoteId}`} className="text-forest underline">
                {inv.sourceQuoteReference}
              </Link>
            </>
          ) : null}
          .
        </p>
      </div>
      <Notice notice={noticeFor(first(sp.notice), NOTICES)} />

      {editable ? (
        <>
          <Section title="Edit the draft">
            <DraftForm
              key={inv.draftVersion}
              id={inv.id}
              version={inv.draftVersion}
              monthly={inv.kind === "MONTHLY"}
              dueDate={inv.dueDateString ?? ""}
              lines={inv.lines.map((l) => ({
                id: l.id,
                kind: l.kind,
                description: l.description,
                amount: amountForInput(l.amountCents),
              }))}
            />
          </Section>
          <Section title="Issue">
            <p className="break-words text-sm text-charcoal/70">
              Issuing gives the invoice its number, fixes the amounts, the address and the bank
              details, and emails it with the PDF to {payerName}&apos;s contacts who receive
              invoices. Save any changes above first: issuing uses the saved draft.
            </p>
            {!settings.bankReady ? (
              <p role="alert" className="text-sm text-red-800">
                ACE&apos;s bank details are not entered yet, so this cannot be issued.
              </p>
            ) : null}
            <IssueForm id={inv.id} disabled={!settings.bankReady} />
          </Section>
        </>
      ) : null}

      {inv.status === "DRAFT" ? (
        <details className="rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10">
          <summary className="min-h-10 cursor-pointer py-2 font-display text-base font-semibold text-forest">
            Delete this draft
          </summary>
          <form action={deleteInvoiceDraftAction} className="mt-3 space-y-3">
            <input type="hidden" name="id" value={inv.id} />
            <input type="hidden" name="confirm" value="yes" />
            <p className="text-sm text-charcoal/70">
              {anonymised
                ? "This customer has been anonymised, so this draft can no longer be edited or issued. Deleting it removes it."
                : inv.kind === "MONTHLY"
                  ? "Deleting skips this month's invoice for this customer. If you run the same month again, the draft is made again with the amounts as they are then."
                  : "Deleting removes this draft and its lines. Nothing was sent, so the customer sees nothing."}
            </p>
            <button type="submit" className={dangerButtonClass}>
              Yes, delete the draft
            </button>
          </form>
        </details>
      ) : null}

      {inv.status !== "DRAFT" ? (
        <Section title="Payment and email">
          <div className="flex flex-wrap gap-2">
            <a
              href={`/invoices/${inv.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className={secondaryButtonClass}
            >
              Download PDF<span className="sr-only"> (opens in a new tab)</span>
            </a>
            {owing ? (
              <Link
                href={`/payments/new?payer=${inv.billTo.id}&invoice=${inv.id}`}
                className={secondaryButtonClass}
              >
                Record payment
              </Link>
            ) : null}
          </div>
          <p className="text-sm">
            {inv.status === "VOID"
              ? `Total ${formatZAR(inv.totalCents)}. Voided: nothing is owed.`
              : `Total ${formatZAR(inv.totalCents)}, paid ${formatZAR(inv.allocatedCents)}, still owed ${formatZAR(Math.max(0, inv.balanceCents))}${inv.dueDateString ? `, due ${day(inv.dueDateString)}` : ""}.`}
          </p>
          <p className="text-sm text-charcoal/70">
            {inv.emailStatus === "SENT" && inv.emailedAt
              ? `Emailed ${formatDateTimeSA(inv.emailedAt)}.`
              : inv.emailStatus === "FAILED"
                ? "The email could not be sent (nobody receives invoices, or the send failed). Check the contacts, then resend."
                : "Not emailed yet."}
          </p>
          {inv.status === "ISSUED" ? (
            <form action={resendInvoiceEmailAction}>
              <input type="hidden" name="id" value={inv.id} />
              <button type="submit" className={secondaryButtonClass}>
                Resend email
              </button>
            </form>
          ) : null}
          {inv.allocations.length > 0 ? (
            <ul className="divide-y divide-charcoal/10 text-sm">
              {inv.allocations.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <Link
                    href={`/payments/${a.payment.id}`}
                    className="inline-flex min-h-10 items-center text-forest underline"
                  >
                    Payment of {day(a.payment.receivedOn)}
                  </Link>
                  <span className="inline-flex items-center">
                    {formatZAR(a.amountCents)}
                    {a.payment.voidedAt ? " (payment voided, not counted)" : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {inv.status === "VOID" && inv.voidedAt ? (
            <p className="break-words text-sm text-charcoal/70">
              Voided {formatDateTimeSA(inv.voidedAt)}
              {inv.voidReason ? `: ${inv.voidReason}` : "."}
            </p>
          ) : null}
          {inv.status === "ISSUED" && inv.allocatedCents === 0 ? (
            <details>
              <summary className="min-h-10 cursor-pointer py-2 text-sm font-semibold text-red-700">
                Void this invoice
              </summary>
              <div className="mt-2 space-y-2">
                <p className="text-sm text-charcoal/70">
                  A voided invoice is kept with its number but owes nothing. To correct it, void it
                  and make a new one.
                </p>
                <VoidForm id={inv.id} />
              </div>
            </details>
          ) : null}
        </Section>
      ) : null}

      {waiting.length > 0 ? (
        <Section title="Reported payments">
          <ul className="space-y-3 text-sm">
            {waiting.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words">
                  Paid on {day(r.paidOn)}
                  {r.reference ? `, reference ${r.reference}` : ""} (
                  {PAYMENT_REPORT_STATUS_LABELS[r.status]})
                </span>
                <span className="flex flex-wrap gap-2">
                  <Link href={`/payments/new?report=${r.id}`} className={secondaryButtonClass}>
                    Confirm
                  </Link>
                  <form action={dismissReportAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="back" value={inv.id} />
                    <button type="submit" className={secondaryButtonClass}>
                      Dismiss
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {doc ? (
        <InvoiceDocumentView
          doc={doc}
          logoSrc={
            doc.logoVersion ? `/company-logo?v=${encodeURIComponent(doc.logoVersion)}` : null
          }
        />
      ) : loaded === "damaged" ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
        >
          This invoice is missing its saved business details, so it cannot be shown. Please tell
          support.
        </p>
      ) : null}

      <Section title="History">
        {history.length === 0 ? (
          <p className="text-sm text-charcoal/60">Nothing yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {history.map((h) => (
              <li key={h.id} className="break-words">
                {formatDateTimeSA(h.at)}: {INVOICE_ACTION_LABELS[h.action] ?? h.action},{" "}
                {h.actorName}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
