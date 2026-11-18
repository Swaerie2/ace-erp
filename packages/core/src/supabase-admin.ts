import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";

/**
 * Admin connection to the sign-in system. It uses the SECRET key, which can bypass every rule,
 * so it must only ever run on the server or in a command on your own computer. Never import this
 * into code that runs in a browser.
 */
export function getSupabaseAdmin() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
