export const RATE_WINDOW_MINUTES = 10;
/** Page views and PDF downloads per visitor per window. */
export const VIEW_LIMIT = 120;
/** Accept or decline attempts per visitor per window. */
export const ACT_LIMIT = 10;

export type RateKind = "view" | "act";

export function windowStartFor(now: Date = new Date()): Date {
  const ms = RATE_WINDOW_MINUTES * 60_000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

export function rateBucket(kind: RateKind, ipHash: string): string {
  return `${kind}:${ipHash}`;
}
