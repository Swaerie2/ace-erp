/**
 * Only the two PUBLIC sign-in settings are needed in the staff app. The secret key is never
 * used here: staff are created from the command line, not from the website.
 */
export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. Copy .env.example to .env.local and fill them in.",
    );
  }
  return { url, key };
}
