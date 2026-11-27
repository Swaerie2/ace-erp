export const RATE_WINDOW_MINUTES = 10;
/** Page views and PDF downloads per visitor per window. */
export const VIEW_LIMIT = 120;
/** Accept or decline attempts (and sign-in code checks) per visitor per window. */
export const ACT_LIMIT = 10;

export type RateKind = "view" | "act" | "code-email" | "code-email-day" | "code-ip";

/** How many requests of each kind one bucket may make in one window, and how long the window is. */
export const RATE_LIMITS: Record<RateKind, { limit: number; windowMinutes: number }> = {
  view: { limit: VIEW_LIMIT, windowMinutes: RATE_WINDOW_MINUTES },
  act: { limit: ACT_LIMIT, windowMinutes: RATE_WINDOW_MINUTES },
  // Sign-in code requests: per email address (hashed) and per visitor (hashed address), per hour; and a
  // daily cap per email address (hashed), so slow requests spread over the day cannot flood one inbox.
  "code-email": { limit: 3, windowMinutes: 60 },
  "code-email-day": { limit: 10, windowMinutes: 1440 },
  "code-ip": { limit: 10, windowMinutes: 60 },
};

export function windowStartFor(
  now: Date = new Date(),
  windowMinutes: number = RATE_WINDOW_MINUTES,
): Date {
  const ms = windowMinutes * 60_000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

/** The rate-limit row key. `hash` is always a hash (of an address or an email), never the value itself. */
export function rateBucket(kind: RateKind, hash: string): string {
  return `${kind}:${hash}`;
}
