import type { QuoteDocument } from "@ace/core";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h3 className="font-display text-lg font-semibold text-forest">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const BANNERS: Partial<Record<QuoteDocument["status"], string>> = {
  DRAFT: "Draft: not yet issued.",
  EXPIRED: "This quote has expired.",
  REPLACED: "This quote has been replaced by a newer version.",
  WITHDRAWN: "This quote has been withdrawn.",
  DECLINED: "This quote was declined.",
};

export function QuoteDocumentView({ doc }: { doc: QuoteDocument }) {
  const banner = BANNERS[doc.status];
  const includedRows = doc.pricing.rows;
  return (
    <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-charcoal/10 sm:p-8">
      <header>
        <p className="font-display text-sm font-semibold uppercase tracking-wide text-ochre">
          {doc.business.tradingName}
        </p>
        <h2 className="mt-1 font-display text-2xl font-semibold text-forest">
          Proposal and quotation
        </h2>
        <p className="mt-1 text-charcoal/70">{doc.tagline}</p>
      </header>

      {banner ? (
        <p className="mt-4 rounded-lg bg-ochre/10 px-3 py-2 text-sm font-semibold text-charcoal ring-1 ring-ochre/30">
          {banner}
        </p>
      ) : null}

      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-charcoal/60">Reference</dt>
          <dd className="font-semibold text-forest">{doc.reference}</dd>
        </div>
        <div>
          <dt className="text-charcoal/60">Date and validity</dt>
          <dd>
            {doc.issuedDate ? `${doc.issuedDate}, ` : ""}valid until {doc.validUntil}
          </dd>
        </div>
        <div>
          <dt className="text-charcoal/60">Prepared for</dt>
          <dd className="break-words">
            <span className="font-semibold">{doc.preparedFor.name}</span>
            {doc.preparedFor.siteAddress ? (
              <span className="block">{doc.preparedFor.siteAddress}</span>
            ) : null}
            {doc.preparedFor.email ? <span className="block">{doc.preparedFor.email}</span> : null}
            {doc.preparedFor.phone ? <span className="block">{doc.preparedFor.phone}</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-charcoal/60">Prepared by</dt>
          <dd className="break-words">
            <span className="font-semibold">{doc.business.legalName}</span>
            <span className="block">t/a {doc.business.tradingName}</span>
            {doc.business.registrationNumber ? (
              <span className="block">Reg {doc.business.registrationNumber}</span>
            ) : null}
            {doc.business.phone ? <span className="block">{doc.business.phone}</span> : null}
            {doc.business.email ? <span className="block">{doc.business.email}</span> : null}
            {doc.business.website ? <span className="block">{doc.business.website}</span> : null}
          </dd>
        </div>
      </dl>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {doc.summary.monthlyTotal ? (
          <div className="rounded-xl bg-forest/5 p-4 ring-1 ring-forest/15">
            <p className="text-xs uppercase tracking-wide text-charcoal/60">Monthly total</p>
            <p className="mt-1 font-display text-xl font-semibold text-forest">
              {doc.summary.monthlyTotal}
            </p>
            {doc.summary.frequencyLabel ? (
              <p className="text-sm text-charcoal/70">Service: {doc.summary.frequencyLabel}</p>
            ) : null}
          </div>
        ) : null}
        {doc.summary.onceOffTotal ? (
          <div className="rounded-xl bg-forest/5 p-4 ring-1 ring-forest/15">
            <p className="text-xs uppercase tracking-wide text-charcoal/60">Once-off total</p>
            <p className="mt-1 font-display text-xl font-semibold text-forest">
              {doc.summary.onceOffTotal}
            </p>
          </div>
        ) : null}
        {doc.summary.optionalNote ? (
          <div className="rounded-xl bg-ochre/10 p-4 ring-1 ring-ochre/30">
            <p className="text-xs uppercase tracking-wide text-charcoal/60">Optional</p>
            <p className="mt-1 font-semibold text-charcoal">{doc.summary.optionalNote}</p>
          </div>
        ) : null}
      </div>

      <Section title="Scope of service">
        {doc.scope.included.length === 0 ? (
          <p className="text-charcoal/60">No services included yet.</p>
        ) : (
          <ul className="space-y-3">
            {doc.scope.included.map((s) => (
              <li key={s.name} className="rounded-xl bg-forest/5 p-4 ring-1 ring-forest/20">
                <p className="font-semibold text-forest">
                  <span aria-hidden="true">✓ </span>
                  {s.name}
                </p>
                {s.bullets.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-charcoal">
                    {s.bullets.map((b, i) => (
                      <li key={`${i}-${b}`}>{b}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {doc.scope.excludedNames.length > 0 || doc.scope.standardExclusions.length > 0 ? (
          <div className="mt-4 rounded-xl bg-charcoal/5 p-4">
            <p className="font-semibold text-charcoal/80">
              Not included (quoted separately on request)
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-charcoal/70">
              {doc.scope.excludedNames.map((n, i) => (
                <li key={`${i}-${n}`}>{n}</li>
              ))}
              {doc.scope.standardExclusions.map((n, i) => (
                <li key={`${i}-${n}`}>{n}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      <Section title="Pricing">
        {includedRows.length === 0 ? (
          <p className="text-charcoal/60">No price lines yet.</p>
        ) : (
          <ul className="divide-y divide-charcoal/10 rounded-xl ring-1 ring-charcoal/10">
            {includedRows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <div className="min-w-0 basis-56 flex-1">
                  <p className="break-words">{r.description || "(no description)"}</p>
                  <p className="text-xs text-charcoal/60">
                    {[
                      r.kind === "OPTIONAL" ? "Optional add-on" : null,
                      r.billingLabel,
                      r.frequencyLabel,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <p className="font-semibold text-forest">{r.amountLabel}</p>
              </li>
            ))}
          </ul>
        )}
        <dl className="mt-3 space-y-1 text-sm">
          {doc.pricing.totals.monthly ? (
            <div className="flex justify-between gap-4">
              <dt>
                Monthly total
                {doc.pricing.totals.monthlyWithOptions ? " (excluding optional add-ons)" : ""}
              </dt>
              <dd className="font-semibold">{doc.pricing.totals.monthly}</dd>
            </div>
          ) : null}
          {doc.pricing.totals.monthlyWithOptions ? (
            <div className="flex justify-between gap-4">
              <dt>Monthly total with optional add-ons</dt>
              <dd className="font-semibold">{doc.pricing.totals.monthlyWithOptions}</dd>
            </div>
          ) : null}
          {doc.pricing.totals.onceOff ? (
            <div className="flex justify-between gap-4">
              <dt>Once-off total</dt>
              <dd className="font-semibold">{doc.pricing.totals.onceOff}</dd>
            </div>
          ) : null}
          {doc.pricing.totals.onceOffWithOptions ? (
            <div className="flex justify-between gap-4">
              <dt>Once-off total with optional add-ons</dt>
              <dd className="font-semibold">{doc.pricing.totals.onceOffWithOptions}</dd>
            </div>
          ) : null}
        </dl>
        <p className="mt-3 text-xs text-charcoal/60">{doc.vatNote}</p>
      </Section>

      {doc.termSections.map((section) => (
        <Section key={section.title} title={`Terms: ${section.title}`}>
          <dl className="space-y-2 text-sm">
            {section.clauses.map((c, i) => (
              <div key={`${i}-${c.heading}`}>
                <dt className="font-semibold text-charcoal">{c.heading}</dt>
                <dd className="text-charcoal/80">{c.body}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ))}

      {doc.everyVisitPoints.length > 0 ? (
        <Section title="Every visit on record">
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-charcoal">
            {doc.everyVisitPoints.map((p, i) => (
              <li key={`${i}-${p}`}>{p}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </article>
  );
}
