import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import { getDatabaseUrl } from "./env";

// During development the server reloads often; keep one connection pool, not one per reload.
const globalForDb = globalThis as unknown as { __aceDb?: PrismaClient };

/** The one shared database connection. Server-side use only. */
export function getDb(): PrismaClient {
  if (!globalForDb.__aceDb) {
    const adapter = new PrismaPg({ connectionString: getDatabaseUrl() });
    globalForDb.__aceDb = new PrismaClient({ adapter });
  }
  return globalForDb.__aceDb;
}

export type Db = PrismaClient;
