import { FREQUENCY_LABELS, formatZAR, type getPropertyAgreement } from "@ace/core";
import Link from "next/link";
import { formatDate } from "@/lib/format";

type Agreement = Awaited<ReturnType<typeof getPropertyAgreement>>;
type AgreementQuote = NonNullable<Agreement["current"]>;

function frequencyText(frequency: string | null): string {
  const label = frequency
    ? (FREQUENCY_LABELS as Record<string, string | undefined>)[frequency]
    : undefined;
  return label ? `, ${label.toLowerCase()}` : "";
}

function lineText(l: AgreementQuote["lines"][number]): string {
  if (l.lineKind === "INCLUDED") return `${l.description} (included)`;
  const amount = formatZAR(l.amountCents ?? 0);
  if (l.billing === "MONTHLY") {
    return `${l.description}: ${amount} per month${frequencyText(l.frequency)}`;
  }
  return `${l.description}: ${amount} once-off`;
}

function QuoteBlock({ title, q }: { title: string; q: AgreementQuote }) {
  return (
    <div className="rounded-xl bg-forest/5 p-4 ring-1 ring-forest/20">
      <p className="font-semibold text-forest">
        {title}{" "}
        <Link href={`/quotes/${q.id}`} className="underline">
          {q.reference}
        </Link>
        {q.acceptedStartDate ? (
          <span className="font-normal text-charcoal/70">
            {" "}
            · starts {formatDate(q.acceptedStartDate)}
          </span>
        ) : null}
      </p>
      <p className="mt-1 text-sm text-charcoal">
        Services: {q.scope.map((s) => s.name).join(", ") || "none"}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-charcoal">
        {q.lines.map((l) => (
          <li key={l.id}>{lineText(l)}</li>
        ))}
      </ul>
    </div>
  );
}

export function AgreementPanel({ agreement }: { agreement: Agreement }) {
  if (!agreement.current && agreement.onceOff.length === 0) {
    return (
      <p className="mt-3 text-sm text-charcoal/60">No accepted quote for this property yet.</p>
    );
  }
  return (
    <div className="mt-3 space-y-3">
      <h3 className="font-display text-base font-semibold text-forest">Agreed scope</h3>
      {agreement.current ? <QuoteBlock title="Monthly agreement" q={agreement.current} /> : null}
      {agreement.onceOff.map((q) => (
        <QuoteBlock key={q.id} title="Once-off work" q={q} />
      ))}
    </div>
  );
}
