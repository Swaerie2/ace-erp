"use server";

import { getPortalDb } from "@ace/core";
import { signOut } from "@ace/core/portal";
import { redirect } from "next/navigation";
import { clearSessionCookie, readSessionToken } from "@/lib/session";

/** Deletes the session row and the cookie, then goes to the sign-in page. */
export async function signOutAction(): Promise<void> {
  await signOut(getPortalDb(), await readSessionToken());
  await clearSessionCookie();
  redirect("/sign-in");
}
