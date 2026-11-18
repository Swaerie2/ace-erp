// Starts Next.js with the repo-root `.env.local` already loaded into the environment, so every
// part of the app (pages, actions, the sign-in guard) sees the same settings.
//
//   node ../../scripts/next-with-env.mjs dev -p 3100
//
// On the live host there is no .env.local: settings come from the hosting dashboard, and this
// launcher simply passes the real environment straight through.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");

const env = { ...process.env };
if (fs.existsSync(envFile)) {
  for (const [key, value] of Object.entries(parse(fs.readFileSync(envFile)))) {
    // Values already set in the real environment win over the file.
    if (env[key] === undefined || env[key] === "") env[key] = value;
  }
}

// Run from inside an app folder: find that app's own copy of Next.js.
const nextBin = createRequire(path.join(process.cwd(), "package.json")).resolve(
  "next/dist/bin/next",
);

const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
