import "server-only";
import { getPortalBaseUrl } from "@ace/core";

/** Where the client portal lives (no trailing slash). In development it defaults to the local portal. */
export function getPortalUrl(): string {
  return getPortalBaseUrl();
}
