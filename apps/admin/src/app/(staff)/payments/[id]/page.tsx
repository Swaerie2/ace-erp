import {
  formatCustomerNumber,
  formatDateSA,
  formatDateTimeSA,
  formatZAR,
  fromDateString,
  getDb,
  getPayment,
  openInvoicesForPayer,
} from "@ace/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Notice, noticeFor, type NoticeText } from "@/components/notice";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { first } from "@/lib/search-params";
import { PendingButton } from "../../invoices/pending-button";
import { unallocateAction } from "../actions";
import { AllocateForm, VoidPaymentForm } from "./payment-forms";

const ANONYMISED = "This customer has been anonymised and cannot be changed.";

const NOTICES: Record<string, NoticeText> = {
  recorded: { text: "Payment recorded.", ok: true },
  confirmed: { text: "Payment recorded and the client's report confirmed.", ok: true },
  allocated: { text: "Allocated.", ok: true },
  unallocated: { text: "Allocation removed. The money is credit on account again.", ok: true },
  voided: { text: "Payment voided. Its allocations no longer count.", ok: true },
  "voided-already": { text: "This payment has been voided.", ok: false },
  anonymised: { text: ANONYMISED, ok: false },
  cannot: { text: "That could not be done. Refresh the page and try again.", ok: false },
};

const day = (value: string) => formatDateSA(fromDateString(value));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10">
      <h2 className="font-display text-lg font-semibold text-forest">{title}</h2>
      {children}
    </section>
  );
}

export default async function PaymentPage({
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
  const p = await getPayment(db, actor, id);
  if (!p) notFound();
  const voided = Boolean(p.voidedAt);
  const anonymised = Boolean(p.payer.anonymisedAt);
  const changeable = !voided && !anonymised;
  const open =
    changeable && p.unallocatedCents > 0 ? await openInvoicesForPayer(db, actor, p.payer.id) : [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/payments"
        className="inline-flex min-h-10 items-center text-sm text-forest hover:underline"
      >
        ← Payments
      </Link>
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold text-forest">
            Payment of {formatZAR(p.amountCents)}
          </h1>
          {voided ? (
            <span className="rounded-full bg-charcoal/10 px-2.5 py-1 text-xs font-semibold text-charcoal/50">
              Void
            </span>
          ) : null}
        </div>
        <p className="mt-1 break-words text-sm text-charcoal/70">
          From{" "}
          <Link
            href={`/customers/${p.payer.id}?tab=invoices`}
            className="font-semibold text-forest underline"
          >
            {p.payer.displayName}
          </Link>{" "}
          {formatCustomerNumber(p.payer.number)}, received {day(p.receivedOn)}
          {p.reference ? `, reference ${p.reference}` : ""}. Recorded{" "}
          {formatDateTimeSA(p.createdAt)}.
        </p>
        {p.note ? (
          <p className="mt-1 whitespace-pre-line break-words text-sm text-charcoal/70">
            Note: {p.note}
          </p>
        ) : null}
      </div>
      <Notice notice={noticeFor(first(sp.notice), NOTICES)} />

      {voided && p.voidedAt ? (
        <p className="break-words rounded-lg bg-charcoal/10 px-3 py-2 text-sm">
          Voided {formatDateTimeSA(p.voidedAt)}
          {p.voidReason ? `: ${p.voidReason}` : "."} Voided: nothing is allocated now, and this
          payment gives no credit on account.
        </p>
      ) : null}
      {anonymised && !voided ? (
        <p className="rounded-lg bg-charcoal/10 px-3 py-2 text-sm">
          {ANONYMISED} So this payment&apos;s allocations can no longer be changed, and it cannot be
          voided.
        </p>
      ) : null}

      {voided ? (
        <Section title="Was allocated to (no longer counts)">
          {p.allocations.length === 0 ? (
            <p className="text-sm text-charcoal/60">It was not allocated to any invoice.</p>
          ) : (
            <ul className="divide-y divide-charcoal/10 text-sm text-charcoal/60">
              {p.allocations.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link
                    href={`/invoices/${a.invoiceId}`}
                    className="inline-flex min-h-10 min-w-0 items-center break-words underline"
                  >
                    {a.reference ?? "Invoice"}
                    {a.forName ? `, ${a.forName}` : ""}
                  </Link>
                  <span className="line-through">{formatZAR(a.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : (
        <Section title="Allocated to">
          {p.allocations.length === 0 ? (
            <p className="text-sm text-charcoal/60">Not allocated to any invoice.</p>
          ) : (
            <ul className="divide-y divide-charcoal/10 text-sm">
              {p.allocations.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link
                    href={`/invoices/${a.invoiceId}`}
                    className="inline-flex min-h-10 min-w-0 items-center break-words text-forest underline"
                  >
                    {a.reference ?? "Invoice"}
                    {a.forName ? `, ${a.forName}` : ""}
                  </Link>
                  <span className="flex items-center gap-3">
                    {formatZAR(a.amountCents)}
                    {changeable ? (
                      <form action={unallocateAction}>
                        <input type="hidden" name="paymentId" value={p.id} />
                        <input type="hidden" name="allocationId" value={a.id} />
                        <PendingButton
                          label="Remove"
                          pendingLabel="Removing..."
                          className="min-h-10 px-2 text-sm font-semibold text-red-700 underline"
                        />
                      </form>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm">
            Not allocated (credit on account):{" "}
            <span className="font-semibold">{formatZAR(p.unallocatedCents)}</span>
          </p>
        </Section>
      )}

      {changeable && p.unallocatedCents > 0 ? (
        <Section title="Allocate the rest">
          {open.length === 0 ? (
            <p className="text-sm text-charcoal/60">
              Nothing billed to {p.payer.displayName} is owed right now, so the rest stays as credit
              on account.
            </p>
          ) : (
            <AllocateForm
              paymentId={p.id}
              options={open.map((o) => ({
                id: o.id,
                label: `${o.reference}${o.forName ? `, ${o.forName}` : ""}: ${formatZAR(o.balanceCents)} owed${o.dueDate ? `, due ${day(o.dueDate)}` : ""}`,
              }))}
            />
          )}
        </Section>
      ) : null}

      {changeable ? (
        <details className="rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10">
          <summary className="min-h-10 cursor-pointer py-2 font-display text-base font-semibold text-red-700">
            Void this payment
          </summary>
          <VoidPaymentForm paymentId={p.id} />
        </details>
      ) : null}
    </div>
  );
}
