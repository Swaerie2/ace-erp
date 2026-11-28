import {
  currentMonthSA,
  DRAFT_WARNING_LABELS,
  formatCustomerNumber,
  formatDateSA,
  formatMonthLabel,
  formatZAR,
  fromDateString,
  getDb,
  INVOICE_FILTERS,
  invoiceSettingsStatus,
  listDraftsForReview,
  listInvoices,
} from "@ace/core";
import Link from "next/link";
import { inputClass } from "@/components/auth-card";
import { dangerButtonClass, secondaryButtonClass } from "@/components/form";
import { Notice, noticeFor, type NoticeText } from "@/components/notice";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { first, nonNegativeInt, positiveInt } from "@/lib/search-params";
import { issueAllAction, runMonthAction } from "./actions";
import { PendingButton } from "./pending-button";
import { InvoiceStatusBadge } from "./status-badge";

/**
 * The monthly run and "Issue all" are server actions on this page and can take a while (one transaction per
 * customer or draft), so allow up to 5 minutes instead of the platform's shorter default.
 */
export const maxDuration = 300;

type Param = string | string[] | undefined;
type Search = {
  q?: Param;
  status?: Param;
  page?: Param;
  notice?: Param;
  created?: Param;
  skipped?: Param;
  failed?: Param;
  issued?: Param;
  remaining?: Param;
};

/** Must match ISSUE_BATCH in ./actions (one press of "Issue all" works through at most this many). */
const ISSUE_BATCH = 50;

const FILTER_LABELS: Record<"ALL" | (typeof INVOICE_FILTERS)[number], string> = {
  ALL: "All",
  DRAFT: "Drafts",
  UNPAID: "Unpaid",
  OVERDUE: "Overdue",
  PAID: "Paid",
  VOID: "Void",
};

const FIXED: Record<string, NoticeText> = {
  deleted: { text: "Draft deleted.", ok: true },
  cannot: { text: "That could not be done. Refresh the page and try again.", ok: false },
  "run-month": { text: "Choose a month from a year ago up to next month.", ok: false },
};

const primaryLinkClass =
  "inline-flex min-h-10 items-center justify-center rounded-full bg-forest px-5 py-2.5 font-display text-sm font-semibold text-cream hover:bg-forest-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest";

const day = (value: string) => formatDateSA(fromDateString(value));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Counts are whole numbers from the address bar; nothing typed is ever shown. */
function pageNotice(sp: Search): NoticeText | null {
  const code = first(sp.notice);
  const n = (p: Param) => nonNegativeInt(p) ?? 0;
  if (code === "run") {
    const failed = n(sp.failed);
    return {
      text:
        `Created ${plural(n(sp.created), "draft")}. Skipped ${plural(n(sp.skipped), "customer")} (already invoiced for that month, not started yet, nothing to bill, paused, archived or still a lead).` +
        (failed > 0
          ? ` ${plural(failed, "customer")} could not be drafted: press the button again to retry.`
          : ""),
      ok: failed === 0,
    };
  }
  if (code === "issued-all") {
    const failed = n(sp.failed);
    const remaining = n(sp.remaining);
    return {
      text:
        `Issued ${plural(n(sp.issued), "invoice")}. The emails go out in the background.` +
        (failed > 0
          ? ` ${failed} could not be issued and ${failed === 1 ? "is" : "are"} still in the drafts list below. Open one to see why.`
          : "") +
        (remaining > 0
          ? ` ${plural(remaining, "draft")} remain: press "Issue all" again to issue the next ${Math.min(ISSUE_BATCH, remaining)}.`
          : ""),
      ok: failed === 0,
    };
  }
  return noticeFor(code, FIXED);
}

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await requireStaff(["OWNER", "MANAGER"]); // every page starts with this
  const sp = await searchParams;
  const actor = await toActor(staff);
  const db = getDb();
  const q = (first(sp.q) ?? "").trim().slice(0, 100);
  const status = INVOICE_FILTERS.find((f) => f === first(sp.status));
  const page = positiveInt(sp.page, 10_000) ?? 1;
  const [settings, drafts, result] = await Promise.all([
    invoiceSettingsStatus(db, actor),
    listDraftsForReview(db, actor),
    listInvoices(db, actor, { q, status, page }),
  ]);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const link = (over: { status?: string | undefined; page?: number }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const s = "status" in over ? over.status : status;
    if (s) params.set("status", s);
    if (over.page && over.page > 1) params.set("page", String(over.page));
    const text = params.toString();
    return text ? `/invoices?${text}` : "/invoices";
  };
  const batch = Math.min(ISSUE_BATCH, drafts.length);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-forest">Invoices</h1>
        <Link href="/invoices/new" className={primaryLinkClass}>
          New once-off invoice
        </Link>
      </div>
      <Notice notice={pageNotice(sp)} />
      {!settings.bankReady ? (
        <p
          role="alert"
          className="rounded-lg bg-ochre/10 px-3 py-2 text-sm text-charcoal ring-1 ring-ochre/30"
        >
          ACE&apos;s bank details are not entered yet, so invoices cannot be issued.{" "}
          {staff.role === "OWNER" ? (
            <Link href="/settings/invoices" className="font-semibold text-forest underline">
              Enter them in Invoice settings
            </Link>
          ) : (
            "Ask the owner to enter them in Invoice settings."
          )}
        </p>
      ) : null}

      <section
        aria-labelledby="run-heading"
        className="space-y-3 rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10"
      >
        <h2 id="run-heading" className="font-display text-lg font-semibold text-forest">
          Monthly run
        </h2>
        <p className="text-sm text-charcoal/70">
          Normally done on the 20th. Pre clients get next month&apos;s invoice, due at the end of
          this month. Post clients get this month&apos;s invoice, due on the 25th. Only drafts are
          made: nothing is sent until you issue them. Running it again for the same month makes no
          duplicates.
        </p>
        <form action={runMonthAction} className="flex flex-wrap items-end gap-2">
          <label className="block text-sm font-medium text-charcoal">
            Month of the run
            <input
              type="month"
              name="runMonth"
              required
              defaultValue={currentMonthSA()}
              className={`${inputClass} min-h-10`}
            />
          </label>
          <PendingButton
            label="Create this month's invoices"
            pendingLabel="Creating..."
            className={primaryLinkClass}
          />
        </form>
      </section>

      <section aria-labelledby="drafts-heading" className="space-y-3">
        <h2 id="drafts-heading" className="font-display text-lg font-semibold text-forest">
          Drafts to review ({drafts.length})
        </h2>
        {drafts.length === 0 ? (
          <p className="text-sm text-charcoal/60">No drafts waiting.</p>
        ) : (
          <>
            <ul className="divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
              {drafts.map((d) => (
                <li key={d.id}>
                  <Link href={`/invoices/${d.id}`} className="block px-4 py-3 hover:bg-cream/60">
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="min-w-0 break-words font-semibold text-forest">
                        {d.customer.displayName}{" "}
                        <span className="text-xs font-normal text-charcoal/50">
                          {formatCustomerNumber(d.customer.number)}
                        </span>
                      </span>
                      <span className="font-semibold">{formatZAR(d.totalCents)}</span>
                    </span>
                    <span className="block break-words text-sm text-charcoal/60">
                      {[
                        d.serviceMonth
                          ? `Monthly, ${formatMonthLabel(d.serviceMonth)}`
                          : "Once-off",
                        d.dueDate ? `due ${day(d.dueDate)}` : null,
                        d.billTo.id !== d.customer.id ? `billed to ${d.billTo.displayName}` : null,
                        `${d.lineCount} ${d.lineCount === 1 ? "line" : "lines"}`,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                    {d.warnings.length > 0 ? (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {d.warnings.map((w) => (
                          <span
                            key={w}
                            className="rounded-full bg-ochre/15 px-2 py-0.5 text-xs font-semibold text-ochre"
                          >
                            {DRAFT_WARNING_LABELS[w]}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
            {settings.bankReady ? (
              <details className="rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10">
                <summary className="min-h-10 cursor-pointer py-2 font-display text-base font-semibold text-forest">
                  {drafts.length > ISSUE_BATCH
                    ? `Issue all drafts (the oldest ${ISSUE_BATCH} first)`
                    : `Issue all ${plural(drafts.length, "draft")}`}
                </summary>
                <form action={issueAllAction} className="mt-3 space-y-3">
                  <input type="hidden" name="confirm" value="yes" />
                  {/* "id:version": a draft saved after this page was opened is left as a draft. */}
                  {drafts.map((d) => (
                    <input key={d.id} type="hidden" name="draftId" value={`${d.id}:${d.version}`} />
                  ))}
                  <p className="text-sm text-charcoal/70">
                    Each draft above gets its invoice number and is emailed to the people who
                    receive invoices. Drafts with a problem are left as drafts.
                    {drafts.length > ISSUE_BATCH
                      ? ` One press issues the oldest ${ISSUE_BATCH}; press again for the rest.`
                      : ""}
                  </p>
                  <PendingButton
                    label={
                      drafts.length > ISSUE_BATCH
                        ? `Yes, issue and email the oldest ${batch}`
                        : "Yes, issue and email them all"
                    }
                    pendingLabel="Issuing... (this can take a minute)"
                    className={dangerButtonClass}
                  />
                </form>
              </details>
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby="all-heading" className="space-y-4">
        <h2 id="all-heading" className="font-display text-lg font-semibold text-forest">
          All invoices
        </h2>
        <form method="get" role="search" className="flex flex-wrap gap-2">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <input
            name="q"
            defaultValue={q}
            maxLength={100}
            placeholder="Invoice number or customer name"
            aria-label="Search invoices"
            className={`${inputClass} mt-0 min-h-10 min-w-0 flex-1 basis-56`}
          />
          <button type="submit" className={secondaryButtonClass}>
            Search
          </button>
        </form>
        <nav className="flex flex-wrap gap-2 text-sm font-semibold" aria-label="Status filter">
          {(["ALL", ...INVOICE_FILTERS] as const).map((f) => {
            const active = f === "ALL" ? !status : f === status;
            return (
              <Link
                key={f}
                href={link({ status: f === "ALL" ? undefined : f })}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-10 items-center rounded-full px-4 ${active ? "bg-forest text-cream" : "bg-white/70 text-forest ring-1 ring-charcoal/10 hover:bg-cream"}`}
              >
                {FILTER_LABELS[f]}
              </Link>
            );
          })}
        </nav>
        {result.items.length === 0 ? (
          <p className="text-center text-charcoal/60">
            {q || status ? "No invoices match that search or filter." : "No invoices yet."}
          </p>
        ) : (
          <ul className="divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
            {result.items.map((i) => (
              <li key={i.id}>
                <Link
                  href={`/invoices/${i.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-cream/60"
                >
                  <span className="min-w-0 break-words">
                    <span className="font-semibold text-forest">{i.reference ?? "Draft"}</span>
                    <span className="ml-2 text-sm">{i.customer.displayName}</span>
                    <span className="block text-sm text-charcoal/60">
                      {[
                        formatZAR(i.totalCents),
                        i.status === "ISSUED" && i.balanceCents > 0
                          ? `${formatZAR(i.balanceCents)} owed`
                          : null,
                        i.dueDate ? `due ${day(i.dueDate)}` : null,
                        // A draft's stored payer can be out of date (it is worked out again on the
                        // draft itself), so "billed to" shows only for issued and void invoices.
                        i.status !== "DRAFT" && i.billTo.id !== i.customer.id
                          ? `billed to ${i.billTo.displayName}`
                          : null,
                        i.emailStatus === "FAILED" ? "email not sent" : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </span>
                  <InvoiceStatusBadge status={i.displayStatus} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 ? (
          <nav className="flex items-center justify-between gap-2 text-sm" aria-label="Pages">
            {page > 1 ? (
              <Link
                href={link({ page: page - 1 })}
                className="inline-flex min-h-10 items-center px-2 text-forest hover:underline"
              >
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-center text-charcoal/60">
              Page {Math.min(page, pages)} of {pages} ({result.total} invoices)
            </span>
            {page < pages ? (
              <Link
                href={link({ page: page + 1 })}
                className="inline-flex min-h-10 items-center px-2 text-forest hover:underline"
              >
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
