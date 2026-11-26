import { ACCEPT_METHOD_LABELS, SENT_METHOD_LABELS, formatZAR, type getQuote } from "@ace/core";
import { formatDate, formatDateTime } from "@/lib/format";

type Quote = NonNullable<Awaited<ReturnType<typeof getQuote>>>;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="inline text-charcoal/60">{label}: </dt>
      <dd className="inline">{children}</dd>
    </div>
  );
}

export function QuoteFacts({
  quote,
  customerStatus,
}: {
  quote: Quote;
  customerStatus: "LEAD" | "ACTIVE" | "PAUSED" | "ARCHIVED";
}) {
  const onLink = quote.acceptedMethod === "CLIENT_LINK";
  const inPortal = quote.acceptedMethod === "CLIENT_PORTAL";
  const contact = quote.acceptedByContact;
  const forAgency =
    contact && contact.customerId !== quote.customerId ? contact.customer.displayName : null;
  const chosen = quote.lines.filter((l) => l.lineKind === "OPTIONAL" && l.chosen);
  const rows: React.ReactNode[] = [];
  if (quote.sentAt) {
    rows.push(
      <Row key="sent" label="Sent">
        {formatDateTime(quote.sentAt)}
        {quote.sentMethod ? ` by ${SENT_METHOD_LABELS[quote.sentMethod]}` : ""}
      </Row>,
    );
  }
  if (quote.status === "ACCEPTED" && quote.acceptedAt) {
    rows.push(
      <Row key="accepted" label="Accepted">
        {formatDateTime(quote.acceptedAt)}
        {inPortal
          ? ` in the client portal by ${contact?.name ?? quote.acceptedByName ?? "the client"}${forAgency ? ` (for agency ${forAgency})` : ""}`
          : onLink
            ? ` on the client link by ${quote.acceptedByName ?? "the client"}`
            : `${quote.acceptedMethod ? ` (${ACCEPT_METHOD_LABELS[quote.acceptedMethod]})` : ""}${quote.acceptedByName ? ` by ${quote.acceptedByName}` : ""}`}
      </Row>,
    );
    if (inPortal && quote.acceptedByName && quote.acceptedByName !== contact?.name) {
      rows.push(
        <Row key="typed" label="Name typed on acceptance">
          {quote.acceptedByName}
        </Row>,
      );
    }
    if ((onLink || inPortal) && (customerStatus === "PAUSED" || customerStatus === "ARCHIVED")) {
      rows.push(
        <Row key="customer" label="Check the customer">
          The customer is {customerStatus === "PAUSED" ? "paused" : "archived"}, so they were not
          made active.
        </Row>,
      );
    }
    if (quote.acceptedStartDate) {
      rows.push(
        <Row key="start" label="Service starts">
          {formatDate(quote.acceptedStartDate)}
        </Row>,
      );
    }
    rows.push(
      <Row key="options" label="Optional add-ons chosen">
        {chosen.length === 0
          ? "none"
          : chosen.map((l) => `${l.description} (${formatZAR(l.amountCents ?? 0)})`).join(", ")}
      </Row>,
    );
    if (quote.acceptanceNote) {
      rows.push(
        <Row key="note" label="Note">
          {quote.acceptanceNote}
        </Row>,
      );
    }
    if (quote.agreementEndedAt) {
      rows.push(
        <Row key="ended" label="Agreement">
          replaced by a newer accepted quote on {formatDate(quote.agreementEndedAt)}
        </Row>,
      );
    }
  }
  if (quote.status === "DECLINED" && quote.declinedAt) {
    rows.push(
      <Row key="declined" label="Declined">
        {formatDateTime(quote.declinedAt)}
        {quote.declinedByClient ? " by the client online" : ""}
        {quote.declineReason ? `: ${quote.declineReason}` : ""}
      </Row>,
    );
  }
  if (quote.reversedAt) {
    rows.push(
      <Row key="reversed" label="Last reversal">
        {formatDateTime(quote.reversedAt)}
        {quote.reversalNote ? `: ${quote.reversalNote}` : ""}
      </Row>,
    );
  }
  if (quote.internalNote) {
    rows.push(
      <Row key="internal" label="Internal note (staff only)">
        <span className="whitespace-pre-line">{quote.internalNote}</span>
      </Row>,
    );
  }
  if (rows.length === 0) return null;
  return (
    <dl className="space-y-1 rounded-2xl bg-white/70 p-4 text-sm ring-1 ring-charcoal/10">
      {rows}
    </dl>
  );
}
