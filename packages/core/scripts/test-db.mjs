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

const result = spawnSync(process.execPath, [vitestBin, "run", ".db.test.ts"], {
  cwd: join(here, ".."),
  stdio: "inherit",
  env: { ...process.env, ACE_DB_TESTS: "1" },
});
process.exit(result.status ?? 1);
