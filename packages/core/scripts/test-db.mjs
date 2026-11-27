// Runs the *.db.test.ts files against the DEVELOPMENT database. Every test runs inside a
// transaction that is rolled back, so nothing is kept. Never point this at the live database.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
// override: a DATABASE_URL already exported in the shell must never win over the dev settings.
const envFile = join(here, "..", "..", "..", ".env.local");
const loaded = config({ path: envFile, override: true });
if (loaded.error) {
  console.error("Cannot run database tests: the root .env.local could not be read.");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const vitestBin = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");

// Files that issue quote or invoice numbers hold the counter row lock for a whole (rolled-back) test,
// so parallel files queue on that row and time out. Measured: one file at a time took about 36 minutes;
// unlimited parallel about 11 but timed out intermittently on the counter row; 3 workers takes about
// 14 minutes and was reliable. So 3 is the default. ACE_DB_TEST_WORKERS (2 to 8) sets that many files at
// once; 1 runs one file at a time.
const workers = Number(process.env.ACE_DB_TEST_WORKERS ?? "3");
const parallel =
  Number.isInteger(workers) && workers >= 2 && workers <= 8
    ? [`--maxWorkers=${workers}`]
    : ["--no-file-parallelism"];

const result = spawnSync(process.execPath, [vitestBin, "run", ".db.test.ts", ...parallel], {
  cwd: join(here, ".."),
  stdio: "inherit",
  env: { ...process.env, ACE_DB_TESTS: "1" },
});
process.exit(result.status ?? 1);
