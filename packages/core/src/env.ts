import { z } from "zod";

/**
 * Settings are read from the environment at the moment they are needed, and a missing
 * one fails with a plain message naming it. Secrets are never given defaults.
 */
const databaseUrl = z
  .string({ error: "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in." })
  .min(1, "DATABASE_URL is empty.")
  .refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), {
    error: "DATABASE_URL must be a postgres:// or postgresql:// connection string.",
  });

export function getDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return databaseUrl.parse(env.DATABASE_URL);
}

export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}
