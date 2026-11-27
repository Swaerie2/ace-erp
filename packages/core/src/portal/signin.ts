import type { Db } from "../db";
import { checkRateLimit } from "../quotes/public";
import {
  MAX_CODE_ATTEMPTS,
  codeExpiresAt,
  generateSignInCode,
  hashSignInCode,
  isSignInCodeShape,
  newCodeSalt,
  signInCodeMatches,
} from "./codes";
import { hashEmail, normaliseEmail } from "./email-address";
import { loadPortalScope, needsWelcome, type PortalScope } from "./scope";
import {
  generateSessionToken,
  hashSessionToken,
  isSessionLive,
  isSessionTokenShape,
  newSessionTimes,
  shouldTouchSession,
  slideSessionExpiry,
} from "./session-token";
import type { PortalStore } from "./store";

const DAY_MS = 86_400_000;

export type SignInCodeMessage = { to: string; code: string };
export type RequestCodeOutcome = "SENT" | "NO_MATCH" | "INVALID_EMAIL" | "LIMITED";

/**
 * Deletes codes and sessions that ended more than a day ago. Called on about one request in a hundred
 * (`cleanup` forces or prevents it, for tests).
 */
export async function cleanupPortalSignIns(
  store: Pick<Db, "portalCode" | "portalSession">,
  now: Date = new Date(),
): Promise<void> {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  await store.portalCode.deleteMany({
    where: { OR: [{ createdAt: { lt: dayAgo } }, { expiresAt: { lt: dayAgo } }] },
  });
  await store.portalSession.deleteMany({
    where: { OR: [{ expiresAt: { lt: dayAgo } }, { absoluteExpiresAt: { lt: dayAgo } }] },
  });
}

/**
 * Runs `fn` as one transaction. With the plain portal connection (`getPortalDb()`) it opens one; with a
 * transaction (the tests, or a caller that already opened one) it runs inside that.
 */
async function inOneTransaction<T>(
  store: PortalStore,
  fn: (tx: PortalStore) => Promise<T>,
): Promise<T> {
  const client = store as Partial<Pick<Db, "$transaction">>;
  if (typeof client.$transaction === "function") {
    return client.$transaction((tx) => fn(tx), { timeout: 15_000, maxWait: 10_000 });
  }
  return fn(store);
}

/**
 * Share-locks, until the transaction ends, the customers whose contacts with this email have portal access
 * (only those neither archived nor anonymised; smallest id first). Call it before a sign-in writes a code or
 * a session row for the email, then re-read the visible set.
 *
 * Why the customer row and not the contacts: anonymise locks the customer FIRST (`lockCustomer`, an update
 * of `updatedAt`), then deletes the email's codes and sessions, and only then updates the contacts. A lock
 * on the contacts would make anonymise wait only after it had already deleted the codes and sessions, so a
 * row written by the sign-in would survive. `FOR SHARE` conflicts with that first update, so:
 * - if the sign-in locks first, anonymise waits for it to commit and its later delete (a new statement under
 *   READ COMMITTED) then sees and removes the new code or session row;
 * - if anonymise locks first, this waits for it to commit, Postgres re-checks `anonymisedAt` on the new row
 *   version, and the re-read visible set is empty, so nothing is written.
 * `FOR SHARE` (not `lockCustomer`) so that sign-ins of the same customer do not queue behind each other and
 * do not bump `updatedAt`. As `ace_portal` it needs SELECT on the columns read here and UPDATE on at least
 * one column of `customers` (the role has `status` and `updatedAt`); Prisma has no locking reads, hence
 * `$queryRaw` with explicit columns.
 */
async function lockSignInCustomers(store: Pick<Db, "$queryRaw">, email: string): Promise<void> {
  await store.$queryRaw`
    select cu."id"
      from "customers" cu
     where cu."status" <> 'ARCHIVED'
       and cu."anonymisedAt" is null
       and cu."id" in (
             select c."customerId" from "contacts" c where c."email" = ${email} and c."portalAccess" = true
           )
     order by cu."id"
       for share of cu`;
}

/**
 * Step 1 of signing in. Counts the request against the email (hashed, per hour and per day) and the
 * visitor (hashed) limits,
 * then, only if the email belongs to a contact in scope, replaces that email's unused codes with a new one
 * and hands it to `send`. The caller shows the same reply for SENT and NO_MATCH (and both paths do the same
 * lock and visible-set reads).
 *
 * `deps.send` is awaited before SENT is returned, so it must only QUEUE the message and return at once
 * (in the portal: Next.js `after()`, which sends once the reply has gone). Actually sending inside it would
 * make SENT slower than NO_MATCH and show that the email is on file. `send` owns its own try/catch and logs
 * fixed words only (never the error or the address); the catch below is only a safety net.
 */
export async function requestSignInCode(
  store: PortalStore,
  input: { email: string; ipHash: string },
  deps: { send: (message: SignInCodeMessage) => Promise<void>; now?: Date; cleanup?: boolean },
): Promise<{ outcome: RequestCodeOutcome }> {
  const email = normaliseEmail(input.email);
  if (!email) return { outcome: "INVALID_EMAIL" };
  const now = deps.now ?? new Date();
  const byEmail = await checkRateLimit(store, "code-email", hashEmail(email), {
    now,
    cleanup: false,
  });
  const byVisitor = await checkRateLimit(store, "code-ip", input.ipHash, {
    now,
    cleanup: deps.cleanup,
  });
  // The daily email cap counts only requests that passed the hourly email and visitor limits: a refused
  // request must not use up the day (anyone could otherwise lock an email out by repeating requests, and a
  // client pressing "send" again would lock themselves out). It runs before the scope lookup, so LIMITED
  // and the statements run never depend on whether the email is on file.
  const allowedSoFar = byEmail.allowed && byVisitor.allowed;
  const byEmailDay = allowedSoFar
    ? await checkRateLimit(store, "code-email-day", hashEmail(email), { now, cleanup: false })
    : { allowed: false };
  if (!allowedSoFar || !byEmailDay.allowed) return { outcome: "LIMITED" };
  if (deps.cleanup ?? Math.random() < 0.01) await cleanupPortalSignIns(store, now);

  // The rate-limit counts above are committed on their own; the lock, the re-read and the new code are one
  // transaction, so a concurrent anonymise cannot leave this email's new code behind.
  const code = await inOneTransaction(store, async (tx) => {
    await lockSignInCustomers(tx, email);
    if (!(await loadPortalScope(tx, email))) return null;
    const fresh = generateSignInCode();
    const salt = newCodeSalt();
    await tx.portalCode.deleteMany({ where: { email, usedAt: null } });
    await tx.portalCode.create({
      data: {
        email,
        codeHash: hashSignInCode(fresh, salt),
        salt,
        expiresAt: codeExpiresAt(now),
        createdAt: now,
      },
      select: { id: true },
    });
    return fresh;
  });
  if (code === null) return { outcome: "NO_MATCH" };
  try {
    await deps.send({ to: email, code });
  } catch {
    // The caller should not throw here; if it does, the reply must still not differ from NO_MATCH.
    // Fixed words only: never the error (it may hold the address) or the address itself.
    console.error("A sign-in code could not be handed to the email sender.");
  }
  return { outcome: "SENT" };
}

/**
 * The answer to a code check. ALL failures are intentionally ONE outcome, `INVALID`: no code for the email
 * (including an email that is not on file), a wrong, malformed, used, expired or dead code, and access
 * removed since the code was sent. Telling these apart would show whether an email is on file. The portal
 * must show the same text and the same next step for every `INVALID`.
 * `LIMITED` depends only on the visitor: this function never returns it; it is the portal's answer when its
 * own "act" rate-limit check (run before calling this) refuses the try, so one type covers the code page.
 */
export type VerifyResult =
  | { outcome: "OK"; token: string; expiresAt: Date; needsWelcome: boolean }
  | { outcome: "INVALID" }
  | { outcome: "LIMITED" };

const INVALID: VerifyResult = { outcome: "INVALID" };
// Compared against when there is no code row, so that case does the same hashing work as a real check.
const DUMMY_SALT = "0".repeat(32);
const DUMMY_HASH = hashSignInCode("no code", DUMMY_SALT);
// Never a real row id: the "no code" case still runs the reserve statement, for similar work.
const NO_ROW_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Step 2 of signing in. Takes the email's newest unused code and first RESERVES one try with a single
 * conditional statement (only while fewer than five tries were counted and the code is live), and only
 * then compares (constant-time). So each code is compared at most five times, however many guesses arrive
 * at once. A match claims the code with one conditional statement (single use) and makes a new session
 * with a fresh random token. Returns the raw token for the cookie; only its hash is stored.
 */
export async function verifySignInCode(
  store: PortalStore,
  input: { email: string; code: string },
  now: Date = new Date(),
): Promise<VerifyResult> {
  const email = normaliseEmail(input.email);
  const code = input.code.replace(/\s/g, "");
  // Depends only on what was typed, so it reveals nothing about the email.
  if (!email || !isSignInCodeShape(code)) return INVALID;
  const row = await store.portalCode.findFirst({
    where: { email, usedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, codeHash: true, salt: true },
  });
  const reserved = await store.portalCode.updateMany({
    where: {
      id: row?.id ?? NO_ROW_ID,
      usedAt: null,
      attempts: { lt: MAX_CODE_ATTEMPTS },
      expiresAt: { gt: now },
    },
    data: { attempts: { increment: 1 } },
  });
  const matches = signInCodeMatches(code, row?.salt ?? DUMMY_SALT, row?.codeHash ?? DUMMY_HASH);
  if (!row || reserved.count !== 1 || !matches) return INVALID;
  // One transaction: lock the customers FIRST (lock order, and anonymise locks the customer before it
  // deletes codes: claiming the code row before the customer lock could deadlock with it), then claim the
  // code, re-read the visible set and make the session.
  return inOneTransaction(store, async (tx): Promise<VerifyResult> => {
    await lockSignInCustomers(tx, email);
    // No attempts condition: this try was already reserved and counted (it may have been the fifth).
    const claimed = await tx.portalCode.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return INVALID;
    // Access may have been removed since the code was sent.
    const scope = await loadPortalScope(tx, email);
    if (!scope) return INVALID;

    const token = generateSessionToken();
    const times = newSessionTimes(now);
    await tx.portalSession.create({
      data: { tokenHash: hashSessionToken(token), email, createdAt: now, ...times },
      select: { id: true },
    });
    await tx.contact.updateMany({
      where: { id: { in: scope.contacts.map((c) => c.id) } },
      data: { lastSignedInAt: now },
    });
    return {
      outcome: "OK",
      token,
      expiresAt: times.absoluteExpiresAt,
      needsWelcome: needsWelcome(scope),
    };
  });
}

export type PortalSession = { sessionId: string; scope: PortalScope };

/**
 * The signed-in person for a cookie value, or null. Valid only while the session has not ended AND the
 * email still has at least one contact in scope (so removing access, archiving or anonymising ends it at
 * once). Touches the session (last seen, sliding end) at most once an hour.
 */
export async function getPortalSession(
  store: PortalStore,
  token: string | null | undefined,
  opts: { now?: Date; cleanup?: boolean } = {},
): Promise<PortalSession | null> {
  if (!token || !isSessionTokenShape(token)) return null;
  const now = opts.now ?? new Date();
  if (opts.cleanup ?? Math.random() < 0.01) await cleanupPortalSignIns(store, now);
  const session = await store.portalSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: { id: true, email: true, lastSeenAt: true, expiresAt: true, absoluteExpiresAt: true },
  });
  if (!session) return null;
  if (!isSessionLive(session, now)) {
    await store.portalSession.deleteMany({ where: { id: session.id } });
    return null;
  }
  const scope = await loadPortalScope(store, session.email);
  if (!scope) return null;
  if (shouldTouchSession(session.lastSeenAt, now)) {
    await store.portalSession.updateMany({
      where: { id: session.id },
      data: { lastSeenAt: now, expiresAt: slideSessionExpiry(now, session.absoluteExpiresAt) },
    });
  }
  return { sessionId: session.id, scope };
}

/** Deletes the session behind this cookie value. */
export async function signOut(
  store: Pick<Db, "portalSession">,
  token: string | null | undefined,
): Promise<void> {
  if (!token || !isSessionTokenShape(token)) return;
  await store.portalSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}
