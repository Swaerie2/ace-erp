import type { PublicQuoteView } from "@ace/core";
import { Notice } from "@/components/notices";

const pdfLinkClass =
  "inline-flex min-h-11 items-center text-sm font-semibold text-forest underline";

export function PdfLink({ href }: { href: string }) {
  return (
    <a href={href} className={pdfLinkClass}>
      Download a PDF copy
    </a>
  );
}

export function AcceptedNotice({
  acceptance,
  pdfHref,
}: {
  acceptance: PublicQuoteView["acceptance"];
  pdfHref: string;
}) {
  return (
    <Notice title="Thank you, this quotation has been accepted" tone="good">
      {acceptance?.name ? <p>Accepted by {acceptance.name}.</p> : null}
      {acceptance?.at ? <p>Accepted on {acceptance.at}.</p> : null}
      {acceptance?.startDate ? <p>Service starts on {acceptance.startDate}.</p> : null}
      <p>
        Optional add-ons chosen:{" "}
        {acceptance && acceptance.chosen.length > 0 ? acceptance.chosen.join(", ") : "none"}.
      </p>
      <p className="pt-1">
        <PdfLink href={pdfHref} />
      </p>
    </Notice>
  );
}
