import { randomBytes } from "node:crypto";

/** 32 random bytes as base64url: 43 URL-safe characters, 256 bits. */
export function generateLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isLinkTokenShape(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}
