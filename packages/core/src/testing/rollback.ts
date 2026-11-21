import { getDb } from "../db";
import type { Prisma } from "../generated/prisma/client";

class Rollback extends Error {}

/** True only when `npm run test:db` switched the database tests on. CI never does. */
export const dbTestsEnabled = process.env.ACE_DB_TESTS === "1";

/**
 * Runs a test inside a database transaction and ALWAYS rolls it back, so tests leave nothing
 * behind. (Customer numbers come from a sequence, so a rolled-back test can leave a gap in the
 * numbering of the dev database. That is harmless.)
 */
export async function withRollback<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let result!: T;
  try {
    await getDb().$transaction(
      async (tx) => {
        result = await fn(tx);
        throw new Rollback();
      },
      { timeout: 150_000, maxWait: 15_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return result;
}
