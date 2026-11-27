import { requireEnv } from "../env";

/** Where the client portal lives (no trailing slash). In development it defaults to the local portal. */
export function getPortalBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value =
    env.NODE_ENV === "production"
      ? requireEnv("PORTAL_URL", env)
      : env.PORTAL_URL || "http://localhost:3200";
  return value.replace(/\/+$/, "");
}

/** The portal's sign-in page. The welcome email links here; there is no secret in the link. */
export function portalSignInUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${getPortalBaseUrl(env)}/sign-in`;
}
