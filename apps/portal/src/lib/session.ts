import "server-only";
import { getPortalDb } from "@ace/core";
import {
  PENDING_EMAIL_MAX_AGE_SECONDS,
  getPortalSession,
  needsWelcome,
  normaliseEmail,
  portalCookieNames,
  portalCookieOptions,
  type PortalSession,
} from "@ace/core/portal";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const names = () => portalCookieNames(process.env.NODE_ENV);
const options = () => portalCookieOptions(process.env.NODE_ENV);

/** The cookie value (the raw session token), if any. */
export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(names().session)?.value;
}

/** The signed-in person, or null. Works in pages, actions and routes. */
export async function getSession(): Promise<PortalSession | null> {
  return getPortalSession(getPortalDb(), await readSessionToken());
}

/**
 * EVERY signed-in page and action calls this first. Not signed in: to /sign-in. A contact not yet welcomed:
 * to /welcome (the welcome page itself passes `allowUnwelcomed`).
 */
export async function requireSession(
  opts: { allowUnwelcomed?: boolean } = {},
): Promise<PortalSession> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!opts.allowUnwelcomed && needsWelcome(session.scope)) redirect("/welcome");
  return session;
}

/** Server actions and route handlers only. The cookie lasts until the session's absolute end. */
export async function setSessionCookie(token: string, expires: Date): Promise<void> {
  (await cookies()).set(names().session, token, { ...options(), expires });
}

/** Server actions and route handlers only. Overwrites with an expired cookie (keeps the __Host- rules). */
export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(names().session, "", { ...options(), maxAge: 0 });
}

/** The typed email between the two sign-in pages, never in the address bar. */
export async function setPendingEmail(email: string): Promise<void> {
  (await cookies()).set(names().pendingEmail, email, {
    ...options(),
    maxAge: PENDING_EMAIL_MAX_AGE_SECONDS,
  });
}

export async function readPendingEmail(): Promise<string | null> {
  const value = (await cookies()).get(names().pendingEmail)?.value;
  return value ? normaliseEmail(value) : null;
}

export async function clearPendingEmail(): Promise<void> {
  (await cookies()).set(names().pendingEmail, "", { ...options(), maxAge: 0 });
}
