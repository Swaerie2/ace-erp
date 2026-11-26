import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** A sign-in code works for this long. */
export const CODE_TTL_MINUTES = 10;
/** After this many wrong tries a code is dead. */
export const MAX_CODE_ATTEMPTS = 5;

/** Six digits from a secure random source ("000000" to "999999"). */
export function generateSignInCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function isSignInCodeShape(value: string): boolean {
  return /^\d{6}$/.test(value);
}

export function newCodeSalt(): string {
  return randomBytes(16).toString("hex");
}

/** Only this hash (with its salt) is stored; the code itself never is. */
export function hashSignInCode(code: string, salt: string): string {
  return createHash("sha256").update(`ace-code-v1:${salt}:${code}`).digest("hex");
}

/** Compares in constant time. A damaged stored hash is simply a mismatch. */
export function signInCodeMatches(code: string, salt: string, expectedHash: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(hashSignInCode(code, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function codeExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + CODE_TTL_MINUTES * 60_000);
}
