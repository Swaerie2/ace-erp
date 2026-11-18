import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// One settings file for the whole repo, kept at the root and never committed.
config({ path: path.resolve(process.cwd(), "../../.env.local") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Migrations use the direct connection; the running apps use the pooled one.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
