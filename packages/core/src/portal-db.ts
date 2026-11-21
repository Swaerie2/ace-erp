import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "./generated/prisma/client";
import { getDatabaseUrl } from "./env";

const globalForPortalDb = globalThis as unknown as { __acePortalDb?: PrismaClient };

/**
 * The connection string the client portal uses. In production it MUST be its own low-privilege login
 * (the `ace_portal` role): the portal fails at startup rather than silently using the staff connection.
 * In development it falls back to the normal connection so a developer need not create the login.
 */
export function getPortalDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const own = env.PORTAL_DATABASE_URL;
  if (own) return own;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "PORTAL_DATABASE_URL is not set. In production the client portal must use its own low-privilege database login.",
    );
  }
  return getDatabaseUrl(env);
}

/** The client portal's database connection. Server-side use only. */
export function getPortalDb(): PrismaClient {
  if (!globalForPortalDb.__acePortalDb) {
    const adapter = new PrismaPg({ connectionString: getPortalDatabaseUrl() });
    globalForPortalDb.__acePortalDb = new PrismaClient({ adapter });
  }
  return globalForPortalDb.__acePortalDb;
}

/** Several portal writes as one all-or-nothing step. */
export function inPortalTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return getPortalDb().$transaction((tx) => fn(tx), { timeout: 15_000, maxWait: 10_000 });
}
