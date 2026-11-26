import { createHash } from "node:crypto";
import { z } from "zod";

const EMAIL = z.email();

/** Trimmed and lowercase, or null when it is not a valid email address (or is longer than 254). */
export function normaliseEmail(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (value.length === 0 || value.length > 254) return null;
  return EMAIL.safeParse(value).success ? value : null;
}

/** The email as a hash, for the rate limiter, which never keeps the address itself. */
export function hashEmail(email: string): string {
  return createHash("sha256").update(`ace-email-v1:${email}`).digest("hex");
}
