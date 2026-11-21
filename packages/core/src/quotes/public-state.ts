import { displayStatus, type QuoteStatusValue } from "./reference";

export type PublicViewState =
  "OPEN" | "EXPIRED" | "ACCEPTED" | "DECLINED" | "REPLACED" | "WITHDRAWN";

/** What a visitor to the private link should be shown. A draft is never visible. */
export function publicViewState(
  q: { status: QuoteStatusValue; validUntil: Date },
  today?: string,
): PublicViewState | null {
  if (q.status === "DRAFT") return null;
  if (q.status === "ISSUED") {
    return displayStatus(q, today) === "EXPIRED" ? "EXPIRED" : "OPEN";
  }
  return q.status;
}
