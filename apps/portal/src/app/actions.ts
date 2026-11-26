"use server";

import { getPortalDb } from "@ace/core";
import { signOut } from "@ace/core/portal";
import { redirect } from "next/navigation";
import { clearSessionCookie, readSessionToken } from "@/lib/session";

/**
 * Deletes the session row and the cookie, then goes to the sign-in page. The cookie is cleared even when
 * the delete fails, so the browser is always signed out.
 */
export async function signOutAction(): Promise<void> {
  try {
    await signOut(getPortalDb(), await readSessionToken());
  } finally {
    await clearSessionCookie();
  }
  redirect("/sign-in");
}
