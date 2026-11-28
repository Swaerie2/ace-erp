import type { InvoiceDocument, StatementDocument } from "@ace/core";

// Rendered inside server components: no hooks, no event handlers. `logoSrc` is the logo URL the app builds
// (for example `/company-logo?v=<version>`); without it the header is exactly as before.

/** The company logo at the top of a document, height-capped. Nothing when there is no logo. */
export function DocumentLogo({ src, alt }: { src?: string | null; alt: string }) {
  if (!src) return null;
  // A plain <img>: the logo comes from the app's own logo route, not from an image optimiser.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className="mb-3 block h-auto max-h-14 w-auto max-w-[10rem]" />;
}

function BankBlock({
  bank,
  bankReady,
  paymentReference,
}: Pick<InvoiceDocument, "bank" | "bankReady" | "paymentReference">) {
  return (
    <section className="mt-6 rounded-xl bg-forest/5 p-4 text-sm ring-1 ring-forest/15">
      <h3 className="font-display text-base font-semibold text-forest">How to pay (EFT)</h3>
      {bankReady ? (
        <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
          <div>
            <dt className="text-charcoal/60">Bank</dt>
            <dd>{bank.bankName}</dd>
          </div>
          <div>
            <dt className="text-charcoal/60">Account holder</dt>
            <dd>{bank.accountHolder}</dd>
          </div>
          <div>
            <dt className="text-charcoal/60">Account number</dt>
            <dd>{bank.accountNumber}</dd>
          </div>
          <div>
            <dt className="text-charcoal/60">Branch code</dt>
            <dd>{bank.branchCode}</dd>
          </div>
          {bank.accountType ? (
            <div>
              <dt className="text-charcoal/60">Account type</dt>
              <dd>{bank.accountType}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="mt-2 text-charcoal/70">Bank details have not been entered yet.</p>
      )}
      <p className="mt-3">
        Use this payment reference:{" "}
        <span className="font-semibold text-forest">{paymentReference}</span>
      </p>
    </section>
  );
}

function Business({ business }: { business: InvoiceDocument["business"] }) {
  return (
    <dd className="break-words">
      <span className="font-semibold">{business.legalName}</span>
      <span className="block">t/a {business.tradingName}</span>
      {business.address ? <span className="block">{business.address}</span> : null}
      {business.registrationNumber ? (
        <span className="block">Reg {business.registrationNumber}</span>
      ) : null}
      {business.phone ? <span className="block">{business.phone}</span> : null}
      {business.email ? <span className="block">{business.email}</span> : null}
    </dd>
  );
}

export function InvoiceDocumentView({
  doc,
  logoSrc,
}: {
  doc: InvoiceDocument;
  logoSrc?: string | null;
}) {
  return (
    <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-charcoal/10 sm:p-8">
      <header>
        <DocumentLogo src={logoSrc} alt={doc.business.tradingName} />
        <p className="font-display text-sm font-semibold uppercase tracking-wide text-ochre">
          {doc.business.tradingName}
        </p>
        <h2 className="mt-1 font-display text-2xl font-semibold text-forest">{doc.title}</h2>
      </header>
      {doc.banner ? (
        <p className="mt-4 rounded-lg bg-ochre/10 px-3 py-2 text-sm font-semibold text-charcoal ring-1 ring-ochre/30">
          {doc.banner}
        </p>
      ) : null}
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-charcoal/60">Invoice number</dt>
          <dd className="font-semibold text-forest">{doc.reference}</dd>
        </div>
        <div>
          <dt className="text-charcoal/60">Dates</dt>
          <dd>
            {doc.issuedDate ? <span className="block">Issued {doc.issuedDate}</span> : null}
            {doc.dueDate ? <span className="block font-semibold">Due {doc.dueDate}</span> : null}
            {doc.serviceMonthLabel ? (
              <span className="block">Service month: {doc.serviceMonthLabel}</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-charcoal/60">Bill to</dt>
          <dd className="break-words">
            <span className="font-semibold">{doc.billTo.name}</span>
            {doc.billTo.address ? <span className="block">{doc.billTo.address}</span> : null}
            {doc.forCustomerName ? <span className="block">For: {doc.forCustomerName}</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-charcoal/60">From</dt>
          <Business business={doc.business} />
        </div>
      </dl>
      <table className="mt-6 w-full table-fixed text-sm">
        <thead>
          <tr className="border-b border-charcoal/15 text-left text-charcoal/60">
            <th className="py-2 pr-2 font-normal">Description</th>
            <th className="w-28 py-2 text-right font-normal">Amount</th>
          </tr>
        </thead>
        <tbody>
          {doc.rows.map((r) => (
            <tr key={r.id} className="border-b border-charcoal/10 align-top">
              <td className="break-words py-2 pr-2">
                {r.description}
                <span className="block text-xs text-charcoal/50">{r.kindLabel}</span>
              </td>
              <td className="py-2 text-right font-semibold text-forest">{r.amountLabel}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="py-2 pr-2 text-right font-semibold">Total</td>
            <td className="py-2 text-right font-semibold text-forest">{doc.totalLabel}</td>
          </tr>
          {doc.paidLabel ? (
            <tr>
              <td className="py-1 pr-2 text-right">Paid</td>
              <td className="py-1 text-right">{doc.paidLabel}</td>
            </tr>
          ) : null}
          {doc.balanceLabel ? (
            <tr>
              <td className="py-1 pr-2 text-right font-semibold">Balance due</td>
              <td className="py-1 text-right font-semibold">{doc.balanceLabel}</td>
            </tr>
          ) : null}
        </tfoot>
      </table>
      <p className="mt-2 text-xs text-charcoal/60">{doc.vatNote}</p>
      {/* Nothing to pay on a void or paid invoice, so no "How to pay" there. */}
      {doc.showPayment ? (
        <BankBlock
          bank={doc.bank}
          bankReady={doc.bankReady}
          paymentReference={doc.paymentReference}
        />
      ) : null}
    </article>
  );
}

export function StatementDocumentView({
  doc,
  logoSrc,
}: {
  doc: StatementDocument;
  logoSrc?: string | null;
}) {
  return (
    <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-charcoal/10 sm:p-8">
      <header>
        <DocumentLogo src={logoSrc} alt={doc.business.tradingName} />
        <p className="font-display text-sm font-semibold uppercase tracking-wide text-ochre">
          {doc.business.tradingName}
        </p>
        <h2 className="mt-1 font-display text-2xl font-semibold text-forest">Statement</h2>
        <p className="mt-1 text-sm text-charcoal/70">
          {doc.periodLabel}, made {doc.generatedDate}
        </p>
      </header>
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-charcoal/60">Account</dt>
          <dd className="break-words">
            <span className="font-semibold">{doc.customer.name}</span>
            <span className="block">{doc.customer.number}</span>
            {doc.customer.address ? <span className="block">{doc.customer.address}</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-charcoal/60">From</dt>
          <Business business={doc.business} />
        </div>
      </dl>
      <dl className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div className="rounded-xl bg-forest/5 p-3">
          <dt className="text-charcoal/60">Opening balance</dt>
          <dd className="font-semibold">{doc.summary.opening}</dd>
        </div>
        <div className="rounded-xl bg-forest/5 p-3">
          <dt className="text-charcoal/60">Invoiced</dt>
          <dd className="font-semibold">{doc.summary.invoiced}</dd>
        </div>
        <div className="rounded-xl bg-forest/5 p-3">
          <dt className="text-charcoal/60">Paid</dt>
          <dd className="font-semibold">{doc.summary.paid}</dd>
        </div>
        <div className="rounded-xl bg-forest/10 p-3">
          <dt className="text-charcoal/60">{doc.summary.closingNote}</dt>
          <dd className="font-semibold text-forest">{doc.summary.closing}</dd>
        </div>
      </dl>
      {doc.summary.credit ? (
        <p className="mt-2 text-sm text-charcoal/70">
          Includes {doc.summary.credit} paid but not yet matched to an invoice (credit on account).
        </p>
      ) : null}
      <h3 className="mt-6 font-display text-base font-semibold text-forest">In this period</h3>
      {doc.rows.length === 0 ? (
        <p className="mt-2 text-sm text-charcoal/60">Nothing invoiced or paid in this period.</p>
      ) : (
        <ul className="mt-2 divide-y divide-charcoal/10 text-sm">
          {doc.rows.map((r) => (
            <li key={r.key} className="grid grid-cols-[1fr_auto] gap-x-3 py-2">
              <span className="min-w-0 break-words">
                {r.date}: {r.description}
                {r.forName ? (
                  <span className="block text-xs text-charcoal/60">For: {r.forName}</span>
                ) : null}
              </span>
              <span className="text-right">
                {r.debit ? <span className="block">{r.debit}</span> : null}
                {r.credit ? <span className="block text-forest">Paid {r.credit}</span> : null}
                <span className="block text-xs text-charcoal/60">Balance {r.balance}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {doc.byComplex.length > 0 ? (
        <>
          <h3 className="mt-6 font-display text-base font-semibold text-forest">Per complex</h3>
          <ul className="mt-2 divide-y divide-charcoal/10 text-sm">
            {doc.byComplex.map((c) => (
              <li key={c.customerId} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="min-w-0 break-words font-semibold">{c.name}</span>
                <span>
                  Invoiced {c.invoiced}, still owed {c.outstanding}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h3 className="mt-6 font-display text-base font-semibold text-forest">Still owed</h3>
      {doc.outstanding.length === 0 ? (
        <p className="mt-2 text-sm text-charcoal/60">No invoice is waiting for payment.</p>
      ) : (
        <ul className="mt-2 divide-y divide-charcoal/10 text-sm">
          {doc.outstanding.map((o) => (
            <li key={o.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span className="min-w-0 break-words">
                {o.reference}
                {o.forName ? `, ${o.forName}` : ""}, due {o.dueDate}
                {o.overdue ? (
                  <span className="ml-2 font-semibold text-red-800">Overdue</span>
                ) : null}
              </span>
              <span className="font-semibold">{o.balance}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-charcoal/60">{doc.vatNote}</p>
      <BankBlock
        bank={doc.bank}
        bankReady={doc.bankReady}
        paymentReference={doc.paymentReference}
      />
    </article>
  );
}
