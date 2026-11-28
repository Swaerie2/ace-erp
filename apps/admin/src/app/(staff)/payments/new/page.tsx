import {
  formatCentsForInput,
  formatDateSA,
  fromDateString,
  getCustomer,
  getDb,
  getInvoice,
  getPaymentReport,
  INVOICE_STATUS_LABELS,
  listCustomers,
  openInvoicesForPayer,
  todaySA,
} from "@ace/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CustomerSearchForm, searchItems } from "@/components/customer-search";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { first } from "@/lib/search-params";
import { InvoiceStatusBadge } from "../../invoices/status-badge";
import { PaymentForm, type PaymentInitial } from "./payment-form";

type Param = string | string[] | undefined;

const backLinkClass = "inline-flex min-h-10 items-center text-sm text-forest hover:underline";

export default async function NewPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ payer?: Param; report?: Param; invoice?: Param; q?: Param }>;
}) {
  const staff = await requireStaff(["OWNER", "MANAGER"]); // every page starts with this
  const sp = await searchParams;
  const actor = await toActor(staff);
  const db = getDb();
  const today = todaySA();
  const uuid = z.uuid();

  let payerId: string | null = null;
  let reportId: string | null = null;
  let prefillInvoice: string | null = null;
  const initial: PaymentInitial = { receivedOn: today, amount: "", reference: "", allocations: {} };

  const reportParam = uuid.safeParse(first(sp.report));
  if (reportParam.success) {
    const report = await getPaymentReport(db, actor, reportParam.data);
    if (!report || report.status !== "WAITING") {
      return (
        <div className="mx-auto max-w-2xl space-y-4">
          <Link href="/payments/reports" className={backLinkClass}>
            ← Reported payments
          </Link>
          <h1 className="font-display text-2xl font-semibold text-forest">Record a payment</h1>
          <p className="text-sm text-charcoal/70">
            This report has already been dealt with, or it could not be found.
          </p>
        </div>
      );
    }
    payerId = report.billToCustomerId;
    reportId = report.id;
    prefillInvoice = report.invoiceId;
    initial.receivedOn = report.paidOn <= today ? report.paidOn : today;
    initial.reference = report.reference ?? "";
  } else {
    const payerParam = uuid.safeParse(first(sp.payer));
    if (payerParam.success) payerId = payerParam.data;
    const invoiceParam = uuid.safeParse(first(sp.invoice));
    if (invoiceParam.success) prefillInvoice = invoiceParam.data;
  }

  if (!payerId) {
    const q = (first(sp.q) ?? "").trim().slice(0, 100);
    // Archived customers can still owe money, so they are found too.
    const found = q ? await listCustomers(db, actor, { q, status: "ALL", pageSize: 20 }) : null;
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Link href="/payments" className={backLinkClass}>
          ← Payments
        </Link>
        <h1 className="font-display text-2xl font-semibold text-forest">Record a payment</h1>
        <p className="text-sm text-charcoal/70">
          Find who paid. For a complex whose bills go to its managing agency, that is the agency.
        </p>
        <CustomerSearchForm
          basePath="/payments/new"
          param="payer"
          q={q}
          items={found ? searchItems(found.items) : null}
        />
      </div>
    );
  }

  const payer = await getCustomer(db, actor, payerId);
  if (!payer) notFound();
  if (payer.anonymisedAt) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Link href="/payments" className={backLinkClass}>
          ← Payments
        </Link>
        <h1 className="font-display text-2xl font-semibold text-forest">Record a payment</h1>
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
        >
          This customer has been anonymised and cannot be changed, so no payment can be recorded.
        </p>
      </div>
    );
  }
  const [open, reported] = await Promise.all([
    openInvoicesForPayer(db, actor, payer.id),
    reportId && prefillInvoice ? getInvoice(db, actor, prefillInvoice) : Promise.resolve(null),
  ]);
  const target = open.find((o) => o.id === prefillInvoice);
  if (target) {
    initial.allocations = { [target.id]: formatCentsForInput(target.balanceCents) };
    initial.amount = formatCentsForInput(target.balanceCents);
  }
  const reportedOwes = reported?.status === "ISSUED" && reported.balanceCents > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        href={reportId ? "/payments/reports" : `/customers/${payer.id}?tab=invoices`}
        className={backLinkClass}
      >
        <span className="min-w-0 break-words">
          ← {reportId ? "Reported payments" : payer.displayName}
        </span>
      </Link>
      <h1 className="font-display text-2xl font-semibold text-forest">Record a payment</h1>
      <p className="break-words text-sm text-charcoal/70">
        From {payer.displayName}.
        {reportId
          ? " The client reported this payment: check it is on the bank statement first. Recording it confirms the report."
          : ""}
      </p>
      {reported ? (
        <div className="space-y-2 rounded-2xl bg-white/70 p-4 text-sm ring-1 ring-charcoal/10">
          <p className="flex flex-wrap items-center gap-2">
            <span>
              Reported against{" "}
              <Link
                href={`/invoices/${reported.id}`}
                className="font-semibold text-forest underline"
              >
                {reported.reference ?? "the invoice"}
              </Link>
              :
            </span>
            <InvoiceStatusBadge status={reported.displayStatus} />
          </p>
          {!reportedOwes ? (
            <p role="alert" className="text-red-800">
              {reported.status === "VOID"
                ? "This invoice has been voided since the report. "
                : `This invoice is ${INVOICE_STATUS_LABELS[reported.displayStatus].toLowerCase()} and owes nothing now. `}
              If you confirm, the money is recorded as credit on account unless you allocate it to
              another invoice below.
            </p>
          ) : null}
        </div>
      ) : null}
      <PaymentForm
        payerId={payer.id}
        reportId={reportId}
        today={today}
        initial={initial}
        open={open.map((o) => ({
          id: o.id,
          reference: o.reference,
          forName: o.forName,
          dueDate: o.dueDate,
          dueLabel: o.dueDate ? formatDateSA(fromDateString(o.dueDate)) : "",
          balanceCents: o.balanceCents,
        }))}
      />
    </div>
  );
}
