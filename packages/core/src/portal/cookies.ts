export type PortalCookieNames = { session: string; pendingEmail: string };

/**
 * Production cookies carry the `__Host-` prefix (the browser then insists on secure, path "/" and no
 * domain). Development runs over plain http, so the names are plain there.
 */
export function portalCookieNames(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): PortalCookieNames {
  return nodeEnv === "production"
    ? { session: "__Host-ace-portal", pendingEmail: "__Host-ace-portal-email" }
    : { session: "ace-portal", pendingEmail: "ace-portal-email" };
}

/** The typed email is remembered between the two sign-in pages for this long. */
export const PENDING_EMAIL_MAX_AGE_SECONDS = 15 * 60;
