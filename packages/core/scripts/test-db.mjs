// Runs the *.db.test.ts files against the DEVELOPMENT database. Every test runs inside a
// transaction that is rolled back, so nothing is kept. Never point this at the live database.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, "..", "..", "..", ".env.local") });

const require = createRequire(import.meta.url);
const vitestBin = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");

const result = spawnSync(process.execPath, [vitestBin, "run", ".db.test.ts"], {
  cwd: join(here, ".."),
  stdio: "inherit",
  env: { ...process.env, ACE_DB_TESTS: "1" },
});
process.exit(result.status ?? 1);
