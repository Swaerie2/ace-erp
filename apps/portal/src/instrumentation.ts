/**
 * Runs once when the portal server starts. In production the portal must have its own low-privilege
 * database login (PORTAL_DATABASE_URL), working email settings (RESEND_API_KEY and EMAIL_FROM) and its
 * public address (PORTAL_URL). Without them it refuses to start (the process exits) and says which one.
 * Only the fixed messages are printed, never a value.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    const { getPortalDatabaseUrl } = await import("@ace/core");
    const { assertEmailConfigured, getPortalBaseUrl } = await import("@ace/core/portal");
    const checks: [() => unknown, string][] = [
      [getPortalDatabaseUrl, "The portal database login is not set."],
      [assertEmailConfigured, "The email settings are not set."],
      [getPortalBaseUrl, "The portal address is not set."],
    ];
    for (const [check, fallback] of checks) {
      try {
        check();
      } catch (error) {
        // The messages of these checks name the setting only (never a value).
        console.error(error instanceof Error ? error.message : fallback);
        process.exit(1);
      }
    }
  }
}
