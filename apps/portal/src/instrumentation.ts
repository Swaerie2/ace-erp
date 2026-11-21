/**
 * Runs once when the portal server starts. In production the portal must use its own low-privilege
 * database login; without PORTAL_DATABASE_URL it refuses to start (the process exits) and says why.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    const { getPortalDatabaseUrl } = await import("@ace/core");
    try {
      getPortalDatabaseUrl();
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : "The portal database login is not set.",
      );
      process.exit(1);
    }
  }
}
