import { createHash, randomBytes } from "node:crypto";

export const SESSION_SLIDING_DAYS = 30;
export const SESSION_ABSOLUTE_DAYS = 90;
/** The session row is touched (last seen, sliding end) at most this often. */
export const SESSION_TOUCH_MINUTES = 60;

const DAY_MS = 86_400_000;

/** 32 random bytes as base64url: the cookie value. Never stored. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isSessionTokenShape(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** What the database keeps instead of the cookie value. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionTimes(now: Date = new Date()) {
  return {
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + SESSION_SLIDING_DAYS * DAY_MS),
    absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_DAYS * DAY_MS),
  };
}

/** 30 days after this use, but never past the absolute end. */
export function slideSessionExpiry(now: Date, absoluteExpiresAt: Date): Date {
  return new Date(
    Math.min(now.getTime() + SESSION_SLIDING_DAYS * DAY_MS, absoluteExpiresAt.getTime()),
  );
}

export function isSessionLive(
  s: { expiresAt: Date; absoluteExpiresAt: Date },
  now: Date = new Date(),
): boolean {
  return now.getTime() < s.expiresAt.getTime() && now.getTime() < s.absoluteExpiresAt.getTime();
}

export function shouldTouchSession(lastSeenAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastSeenAt.getTime() >= SESSION_TOUCH_MINUTES * 60_000;
}
