import { formatDateTime } from "@/lib/format";
import { secondaryButtonClass } from "@/components/form";
import { createLinkAction, revokeLinkAction } from "../actions";
import { CopyButton } from "./copy-button";

type Props = {
  id: string;
  /** The full address, or null when there is no link (never made, or revoked). */
  url: string | null;
  firstViewedAt: Date | null;
  lastViewedAt: Date | null;
};

export function LinkPanel({ id, url, firstViewedAt, lastViewedAt }: Props) {
  return (
    <section
      aria-label="Client link"
      className="rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10"
    >
      <h2 className="font-display text-base font-semibold text-forest">Client link</h2>
      {url ? (
        <>
          <p className="mt-1 text-sm text-charcoal/70">
            Anyone with this link can read this quote and accept or decline it. Send it only to the
            client.
          </p>
          <input
            readOnly
            value={url}
            aria-label="Client link address"
            onFocus={(event) => event.currentTarget.select()}
            className="mt-2 block min-h-11 w-full rounded-lg border border-charcoal/20 bg-white px-3 py-2 text-sm"
          />
          <p className="mt-2 text-sm text-charcoal/70">
            {lastViewedAt
              ? `Last viewed ${formatDateTime(lastViewedAt)}${firstViewedAt && firstViewedAt.getTime() !== lastViewedAt.getTime() ? ` (first opened ${formatDateTime(firstViewedAt)})` : ""}.`
              : "Not opened yet."}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <CopyButton text={url} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <details className="rounded-lg ring-1 ring-charcoal/10">
              <summary className="min-h-10 cursor-pointer px-3 py-2 text-sm font-semibold text-charcoal">
                Revoke link
              </summary>
              <form action={revokeLinkAction} className="space-y-2 px-3 pb-3">
                <p className="text-sm text-charcoal/70">The link stops working straight away.</p>
                <input type="hidden" name="id" value={id} />
                <button type="submit" className={secondaryButtonClass}>
                  Yes, revoke it
                </button>
              </form>
            </details>
            <details className="rounded-lg ring-1 ring-charcoal/10">
              <summary className="min-h-10 cursor-pointer px-3 py-2 text-sm font-semibold text-charcoal">
                Create new link
              </summary>
              <form action={createLinkAction} className="space-y-2 px-3 pb-3">
                <p className="text-sm text-charcoal/70">
                  The old link stops working and a new one is made.
                </p>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="replace" value="yes" />
                <button type="submit" className={secondaryButtonClass}>
                  Yes, make a new link
                </button>
              </form>
            </details>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-charcoal/70">
            There is no client link for this quote. Create one to let the client read and accept it
            online.
          </p>
          <form action={createLinkAction} className="mt-3">
            <input type="hidden" name="id" value={id} />
            <button type="submit" className={secondaryButtonClass}>
              Create link
            </button>
          </form>
        </>
      )}
    </section>
  );
}
