import "server-only";
import { requireEnv } from "@ace/core";

/** Where the client portal lives (no trailing slash). In development it defaults to the local portal. */
export function getPortalUrl(): string {
  const value =
    process.env.NODE_ENV === "production"
      ? requireEnv("PORTAL_URL")
      : (process.env.PORTAL_URL ?? "http://localhost:3200");
  return value.replace(/\/+$/, "");
}
