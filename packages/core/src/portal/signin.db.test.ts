import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { formatCustomerNumber } from "../customers/number";
import { anonymiseCustomer } from "../customers/privacy";
import { lockCustomer } from "../customers/store";
import { hashIp } from "../quotes/bots";
import { owner } from "../quotes/test-helpers";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { hashSignInCode, newCodeSalt } from "./codes";
import { loadPortalScope } from "./scope";
import { hashSessionToken } from "./session-token";
import {
  cleanupPortalSignIns,
  getPortalSession,
  requestSignInCode,
  signOut,
  verifySignInCode,
} from "./signin";
import { addPortalContact, asPortal, mailbox, makeClient, makeSession } from "./test-helpers";

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];

const MIN = 60_000;
const DAY = 86_400_000;
const visitor = () => hashIp(randomUUID());

describe.skipIf(!dbTestsEnabled)("portal sign-in, run as ace_portal", () => {
  it("makes no code and sends nothing for an unknown email, a contact without access, or an archived customer", async () => {
    await withRollback(async (tx) => {
      const box = mailbox();
      const unknown = `${randomUUID()}@example.com`;
      const noAccess = await makeClient(tx, { access: false });
      const archived = await makeClient(tx);
      await tx.customer.update({
        where: { id: archived.customerId },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });
      for (const email of [unknown, noAccess.email, archived.email]) {
        const result = await asPortal(tx, () =>
          requestSignInCode(tx, { email, ipHash: visitor() }, { send: box.send, cleanup: false }),
        );
        expect(result, email).toEqual({ outcome: "NO_MATCH" });
        expect(await tx.portalCode.count({ where: { email } })).toBe(0);
      }
      expect(box.sent).toEqual([]);
      expect(
        await asPortal(tx, () =>
          requestSignInCode(
            tx,
            { email: "not an email", ipHash: visitor() },
            { send: box.send, cleanup: false },
          ),
        ),
      ).toEqual({ outcome: "INVALID_EMAIL" });
    });
  });

  it("sends a code to a known email typed in any case, stores only its salted hash, and replaces an earlier unused code", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const box = mailbox();
      const typed = `  ${client.email.toUpperCase()} `;
      expect(
        await asPortal(tx, () =>
          requestSignInCode(
            tx,
            { email: typed, ipHash: visitor() },
            { send: box.send, cleanup: false },
          ),
        ),
      ).toEqual({ outcome: "SENT" });
      expect(box.sent).toHaveLength(1);
      expect(box.sent[0]?.to).toBe(client.email);
      const first = box.sent[0]!.code;
      expect(first).toMatch(/^\d{6}$/);
      const rows = await tx.portalCode.findMany({ where: { email: client.email } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.codeHash).toBe(hashSignInCode(first, rows[0]!.salt));
      expect(Object.values(rows[0]!)).not.toContain(first);

      await asPortal(tx, () =>
        requestSignInCode(
          tx,
          { email: client.email, ipHash: visitor() },
          { send: box.send, cleanup: false },
        ),
      );
      expect(await tx.portalCode.count({ where: { email: client.email, usedAt: null } })).toBe(1);
      const second = box.sent[1]!.code;
      // Two random codes are equal about once in a million runs; only then is this check skipped.
      if (second !== first) {
        expect(
          await asPortal(tx, () => verifySignInCode(tx, { email: client.email, code: first })),
        ).toEqual({
          outcome: "INVALID",
        });
      }
    });
  });

  it("signs in with the right code: a fresh session stored only as a hash, the code single use, sign out ends it", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx, { welcomed: false });
      const box = mailbox();
      await asPortal(tx, () =>
        requestSignInCode(
          tx,
          { email: client.email, ipHash: visitor() },
          { send: box.send, cleanup: false },
        ),
      );
      const code = box.sent[0]!.code;
      const ok = await asPortal(tx, () =>
        verifySignInCode(tx, { email: client.email, code: ` ${code} ` }),
      );
      expect(ok.outcome).toBe("OK");
      if (ok.outcome !== "OK") return;
      expect(ok.needsWelcome).toBe(true);
      expect(ok.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const sessions = await tx.portalSession.findMany({ where: { email: client.email } });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.tokenHash).toBe(hashSessionToken(ok.token));
      expect(Object.values(sessions[0]!)).not.toContain(ok.token);
      expect(sessions[0]!.absoluteExpiresAt.getTime() - sessions[0]!.createdAt.getTime()).toBe(
        90 * DAY,
      );
      expect(sessions[0]!.expiresAt.getTime() - sessions[0]!.createdAt.getTime()).toBe(30 * DAY);
      expect(ok.expiresAt).toEqual(sessions[0]!.absoluteExpiresAt);
      expect(
        (await tx.contact.findUniqueOrThrow({ where: { id: client.contactId } })).lastSignedInAt,
      ).toBeInstanceOf(Date);

      const session = await asPortal(tx, () => getPortalSession(tx, ok.token, { cleanup: false }));
      expect(session?.scope.email).toBe(client.email);
      expect(session?.scope.customerIds).toEqual([client.customerId]);

      expect(await asPortal(tx, () => verifySignInCode(tx, { email: client.email, code }))).toEqual(
        {
          outcome: "INVALID",
        },
      );

      await asPortal(tx, () => signOut(tx, ok.token));
      expect(await tx.portalSession.count({ where: { email: client.email } })).toBe(0);
      expect(
        await asPortal(tx, () => getPortalSession(tx, ok.token, { cleanup: false })),
      ).toBeNull();

      const audit = await tx.auditLog.findMany({ where: { entityId: client.customerId } });
      expect(JSON.stringify(audit)).not.toContain(client.email);
    });
  });

  it("kills a code after five wrong tries, refuses a code after ten minutes, and treats a malformed code as wrong", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const box = mailbox();
      await asPortal(tx, () =>
        requestSignInCode(
          tx,
          { email: client.email, ipHash: visitor() },
          { send: box.send, cleanup: false },
        ),
      );
      const code = box.sent[0]!.code;
      const wrong = code === "000000" ? "111111" : "000000";
      for (let i = 1; i <= 4; i++) {
        expect(
          await asPortal(tx, () => verifySignInCode(tx, { email: client.email, code: wrong })),
        ).toEqual({
          outcome: "INVALID",
        });
      }
      // the fifth wrong try kills the code, and then even the right code fails
      expect(
        await asPortal(tx, () => verifySignInCode(tx, { email: client.email, code: wrong })),
      ).toEqual({
        outcome: "INVALID",
      });
      expect(await asPortal(tx, () => verifySignInCode(tx, { email: client.email, code }))).toEqual(
        {
          outcome: "INVALID",
        },
      );
      expect(
        (await tx.portalCode.findFirstOrThrow({ where: { email: client.email } })).attempts,
      ).toBe(5);
      expect(await tx.portalSession.count({ where: { email: client.email } })).toBe(0);

      const t0 = new Date();
      const box2 = mailbox();
      await asPortal(tx, () =>
        requestSignInCode(
          tx,
          { email: client.email, ipHash: visitor() },
          { send: box2.send, now: t0, cleanup: false },
        ),
      );
      expect(
        await asPortal(tx, () =>
          verifySignInCode(
            tx,
            { email: client.email, code: box2.sent[0]!.code },
            new Date(t0.getTime() + 10 * MIN),
          ),
        ),
      ).toEqual({ outcome: "INVALID" });
      expect(
        await asPortal(tx, () => verifySignInCode(tx, { email: client.email, code: "12ab56" })),
      ).toEqual({
        outcome: "INVALID",
      });
    });
  });

  it("limits code requests to 3 per email and 10 per visitor per hour, keeping only hashes", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const box = mailbox();
      const now = new Date();
      for (let i = 0; i < 3; i++) {
        const r = await asPortal(tx, () =>
          requestSignInCode(
            tx,
            { email: client.email, ipHash: visitor() },
            { send: box.send, now, cleanup: false },
          ),
        );
        expect(r.outcome).toBe("SENT");
      }
      expect(
        await asPortal(tx, () =>
          requestSignInCode(
            tx,
            { email: client.email, ipHash: visitor() },
            { send: box.send, now, cleanup: false },
          ),
        ),
      ).toEqual({ outcome: "LIMITED" });
      expect(box.sent).toHaveLength(3);

      const ip = visitor();
      for (let i = 0; i < 10; i++) {
        const r = await asPortal(tx, () =>
          requestSignInCode(
            tx,
            { email: `${randomUUID()}@example.com`, ipHash: ip },
            { send: box.send, now, cleanup: false },
          ),
        );
        expect(r.outcome).toBe("NO_MATCH");
      }
      expect(
        await asPortal(tx, () =>
          requestSignInCode(
            tx,
            { email: `${randomUUID()}@example.com`, ipHash: ip },
            { send: box.send, now, cleanup: false },
          ),
        ),
      ).toEqual({ outcome: "LIMITED" });
      const buckets = await tx.publicLinkHit.findMany({
        where: { bucket: { startsWith: "code-" } },
        select: { bucket: true },
      });
      expect(buckets.length).toBeGreaterThan(0);
      expect(JSON.stringify(buckets)).not.toContain(client.email);
    });
  });

  it("limits code requests to 10 per email per day even when the hourly limit is never reached", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const box = mailbox();
      const unknown = `${randomUUID()}@example.com`;
      const day = new Date("2026-11-23T00:00:00.000Z").getTime();
      const at = (hour: number) => new Date(day + hour * 60 * MIN + 5 * MIN);
      const ask = (email: string, now: Date) =>
        asPortal(tx, () =>
          requestSignInCode(
            tx,
            { email, ipHash: visitor() },
            { send: box.send, now, cleanup: false },
          ),
        );
      // 3 + 3 + 3 + 1 across four different hours: each hour stays within its 3.
      for (const [hour, times] of [
        [1, 3],
        [2, 3],
        [3, 3],
        [4, 1],
      ] as const) {
        for (let i = 0; i < times; i++) {
          expect((await ask(client.email, at(hour))).outcome, `hour ${hour}`).toBe("SENT");
        }
      }
      expect(box.sent).toHaveLength(10);
      // The 11th of the day is refused although this hour has had no request yet.
      expect(await ask(client.email, at(5))).toEqual({ outcome: "LIMITED" });
      expect(box.sent).toHaveLength(10);
      // The next day starts fresh.
      expect((await ask(client.email, new Date(day + DAY + 60 * MIN))).outcome).toBe("SENT");

      // Same answer for an email that is not on file: the limit does not depend on it.
      for (let i = 0; i < 10; i++) {
        expect((await ask(unknown, at(6 + Math.floor(i / 3)))).outcome).toBe("NO_MATCH");
      }
      expect(await ask(unknown, at(12))).toEqual({ outcome: "LIMITED" });

      const buckets = await tx.publicLinkHit.findMany({
        where: { bucket: { startsWith: "code-email-day:" } },
        select: { bucket: true },
      });
      expect(buckets.length).toBeGreaterThan(0);
      expect(JSON.stringify(buckets)).not.toContain(client.email);
    });
  });

  it("ends a session at once when access is removed, or the customer is archived or anonymised", async () => {
    await withRollback(async (tx) => {
      const removed = await makeClient(tx);
      const archived = await makeClient(tx);
      const anonymised = await makeClient(tx);
      const tokens = {
        removed: await makeSession(tx, removed.email),
        archived: await makeSession(tx, archived.email),
        anonymised: await makeSession(tx, anonymised.email),
      };
      for (const raw of Object.values(tokens)) {
        expect(
          await asPortal(tx, () => getPortalSession(tx, raw, { cleanup: false })),
        ).not.toBeNull();
      }
      await tx.contact.update({ where: { id: removed.contactId }, data: { portalAccess: false } });
      await tx.customer.update({
        where: { id: archived.customerId },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });
      await tx.customer.update({
        where: { id: anonymised.customerId },
        data: { anonymisedAt: new Date() },
      });
      for (const [label, raw] of Object.entries(tokens)) {
        expect(
          await asPortal(tx, () => getPortalSession(tx, raw, { cleanup: false })),
          label,
        ).toBeNull();
      }
    });
  });

  it("slides for 30 days from the last use, ends at 90 days, and ignores unknown tokens", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const t0 = new Date();
      const raw = await makeSession(tx, client.email, t0);
      const at20 = new Date(t0.getTime() + 20 * DAY);
      expect(
        await asPortal(tx, () => getPortalSession(tx, raw, { now: at20, cleanup: false })),
      ).not.toBeNull();
      const row = await tx.portalSession.findFirstOrThrow({ where: { email: client.email } });
      expect(row.lastSeenAt).toEqual(at20);
      expect(row.expiresAt.getTime()).toBe(at20.getTime() + 30 * DAY);
      // unused for 31 days after that use: gone, and the row is deleted
      expect(
        await asPortal(tx, () =>
          getPortalSession(tx, raw, { now: new Date(at20.getTime() + 31 * DAY), cleanup: false }),
        ),
      ).toBeNull();
      expect(await tx.portalSession.count({ where: { email: client.email } })).toBe(0);

      const t1 = new Date();
      const busy = await makeSession(tx, client.email, t1);
      for (const day of [25, 50, 75]) {
        expect(
          await asPortal(tx, () =>
            getPortalSession(tx, busy, {
              now: new Date(t1.getTime() + day * DAY),
              cleanup: false,
            }),
          ),
          `day ${day}`,
        ).not.toBeNull();
      }
      expect(
        await asPortal(tx, () =>
          getPortalSession(tx, busy, { now: new Date(t1.getTime() + 90 * DAY), cleanup: false }),
        ),
      ).toBeNull();

      expect(await asPortal(tx, () => getPortalSession(tx, "x", { cleanup: false }))).toBeNull();
      expect(
        await asPortal(tx, () => getPortalSession(tx, "A".repeat(43), { cleanup: false })),
      ).toBeNull();
      expect(
        await asPortal(tx, () => getPortalSession(tx, undefined, { cleanup: false })),
      ).toBeNull();
    });
  });

  it("checks at most five guesses per code even when twenty arrive at once, and then refuses the right code", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const code = "246810";
      const salt = newCodeSalt();
      await tx.portalCode.create({
        data: {
          email: client.email,
          codeHash: hashSignInCode(code, salt),
          salt,
          expiresAt: new Date(Date.now() + 10 * MIN),
        },
      });
      const wrong = Array.from({ length: 20 }, (_, i) => String(100000 + i));
      // Started together: every call reads the code row before any of them writes, which is the window a
      // read-compare-then-count design loses. One connection runs the statements one after another, so this
      // is the same interleaving parallel requests would produce, minus true simultaneity (see the report).
      const results = await asPortal(tx, () =>
        Promise.all([
          ...wrong.map((guess) => verifySignInCode(tx, { email: client.email, code: guess })),
          verifySignInCode(tx, { email: client.email, code }),
        ]),
      );
      expect(new Set(results.map((r) => r.outcome))).toEqual(new Set(["INVALID"]));
      // Each counted try is one comparison; the count is reserved before comparing, so it stops at five.
      const row = await tx.portalCode.findFirstOrThrow({
        where: { email: client.email },
        select: { attempts: true, usedAt: true },
      });
      expect(row).toEqual({ attempts: 5, usedAt: null });
      expect(await asPortal(tx, () => verifySignInCode(tx, { email: client.email, code }))).toEqual(
        { outcome: "INVALID" },
      );
      expect(await tx.portalSession.count({ where: { email: client.email } })).toBe(0);
    });
  });

  it("answers no code, a wrong code, a used code and a dead code with the same outcome", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const unknown = `${randomUUID()}@example.com`;
      const noCode = await asPortal(tx, () =>
        verifySignInCode(tx, { email: unknown, code: "123456" }),
      );
      const box = mailbox();
      await asPortal(tx, () =>
        requestSignInCode(
          tx,
          { email: client.email, ipHash: visitor() },
          { send: box.send, cleanup: false },
        ),
      );
      const right = box.sent[0]!.code;
      const wrongCode = right === "000000" ? "111111" : "000000";
      const wrong = await asPortal(tx, () =>
        verifySignInCode(tx, { email: client.email, code: wrongCode }),
      );
      expect(
        (await asPortal(tx, () => verifySignInCode(tx, { email: client.email, code: right })))
          .outcome,
      ).toBe("OK");
      const used = await asPortal(tx, () =>
        verifySignInCode(tx, { email: client.email, code: right }),
      );
      for (const r of [noCode, wrong, used]) expect(r).toEqual({ outcome: "INVALID" });
    });
  });

  it("shows an agency its live complexes only, and a complex never sees the agency's other complexes", async () => {
    await withRollback(async (tx) => {
      const agency = await makeClient(tx, { name: `ZZ E2E Agency ${randomUUID().slice(0, 8)}` });
      const live = await makeClient(tx, { managedById: agency.customerId });
      const other = await makeClient(tx, { managedById: agency.customerId });
      const archived = await makeClient(tx, { managedById: agency.customerId });
      const anonymised = await makeClient(tx, { managedById: agency.customerId });
      await tx.customer.update({
        where: { id: archived.customerId },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });
      await tx.customer.update({
        where: { id: anonymised.customerId },
        data: { anonymisedAt: new Date() },
      });

      const ofAgency = await asPortal(tx, () => loadPortalScope(tx, agency.email));
      expect(ofAgency?.ownCustomerIds).toEqual([agency.customerId]);
      expect(ofAgency?.managedCustomerIds).toEqual([live.customerId, other.customerId].sort());
      expect(ofAgency?.customerIds).toEqual(
        [agency.customerId, live.customerId, other.customerId].sort(),
      );

      const ofComplex = await asPortal(tx, () => loadPortalScope(tx, live.email));
      expect(ofComplex?.customerIds).toEqual([live.customerId]);
      expect(ofComplex?.managedCustomerIds).toEqual([]);
    });
  });

  it("cleans up codes and sessions that ended more than a day ago, and keeps the rest", async () => {
    await withRollback(async (tx) => {
      const email = `${randomUUID()}@example.com`;
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 2 * DAY);
      await tx.portalCode.create({
        data: {
          email,
          codeHash: "0".repeat(64),
          salt: "0".repeat(32),
          expiresAt: twoDaysAgo,
          createdAt: twoDaysAgo,
        },
      });
      await tx.portalCode.create({
        data: {
          email,
          codeHash: "1".repeat(64),
          salt: "1".repeat(32),
          expiresAt: new Date(now.getTime() + 10 * MIN),
        },
      });
      await tx.portalSession.create({
        data: {
          tokenHash: "a".repeat(64),
          email,
          createdAt: new Date(now.getTime() - 40 * DAY),
          lastSeenAt: new Date(now.getTime() - 35 * DAY),
          expiresAt: twoDaysAgo,
          absoluteExpiresAt: new Date(now.getTime() + 50 * DAY),
        },
      });
      await makeSession(tx, email, now);
      await asPortal(tx, () => cleanupPortalSignIns(tx, now));
      expect(await tx.portalCode.count({ where: { email } })).toBe(1);
      expect(await tx.portalSession.count({ where: { email } })).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Sign-in against a concurrent anonymise.
//
// A code or session row must never outlive an anonymise of the customer behind it. Sign-in therefore
// share-locks the customers of the email's contacts (the same row anonymise locks first) before it re-reads
// the visible set and writes. A single rolled-back transaction cannot show two transactions interleaving, so
// these tests use a second connection (its own always-rolled-back transaction) against a COMMITTED customer
// of the dev database, with a made-up contact added inside the test transaction (never committed).
// ---------------------------------------------------------------------------------------------------------

const LOCK_TIMEOUT = `SET LOCAL lock_timeout = '2s'`;
const isLockTimeout = (error: unknown) =>
  /lock timeout|55P03/i.test(error instanceof Error ? error.message : String(error));

/** A committed customer that is neither archived nor anonymised (the dev database always has one). */
async function committedCustomerId(tx: Tx): Promise<string> {
  const found = await tx.customer.findFirst({
    where: { status: { not: "ARCHIVED" }, anonymisedAt: null },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (!found) {
    throw new Error("These tests need one committed, active customer in the dev database.");
  }
  return found.id;
}

/**
 * True when anonymise's first step (`lockCustomer`, from another connection) has to wait for this
 * customer; false when it gets the lock at once. The other connection's work is always rolled back.
 */
async function anonymiseWouldWait(customerId: string): Promise<boolean> {
  try {
    await withRollback(async (other) => {
      await other.$executeRawUnsafe(LOCK_TIMEOUT);
      await lockCustomer(other, customerId);
    });
    return false;
  } catch (error) {
    if (isLockTimeout(error)) return true;
    throw error;
  }
}

/** Holds anonymise's customer lock on another connection while `fn` runs, then rolls it back. */
async function whileAnonymiseHoldsLock<T>(customerId: string, fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let markLocked!: () => void;
  const locked = new Promise<void>((resolve) => (markLocked = resolve));
  const holder = withRollback(async (other) => {
    await lockCustomer(other, customerId);
    markLocked();
    await released;
  });
  await Promise.race([
    locked,
    holder.then(() => {
      throw new Error("The other connection ended before it held the lock.");
    }),
  ]);
  try {
    return await fn();
  } finally {
    release();
    await holder;
  }
}

describe.skipIf(!dbTestsEnabled)("portal sign-in against a concurrent anonymise", () => {
  it("a code request holds a lock on the customer that makes anonymise wait until the sign-in ends", async () => {
    await withRollback(async (tx) => {
      const customerId = await committedCustomerId(tx);
      const { email } = await addPortalContact(tx, customerId);
      // Adding the contact alone (its foreign-key check) does not block anonymise.
      expect(await anonymiseWouldWait(customerId)).toBe(false);
      const box = mailbox();
      expect(
        await asPortal(tx, () =>
          requestSignInCode(tx, { email, ipHash: visitor() }, { send: box.send, cleanup: false }),
        ),
      ).toEqual({ outcome: "SENT" });
      expect(await anonymiseWouldWait(customerId)).toBe(true);
    });
  });

  it("an unknown email locks nothing", async () => {
    await withRollback(async (tx) => {
      const customerId = await committedCustomerId(tx);
      const box = mailbox();
      expect(
        await asPortal(tx, () =>
          requestSignInCode(
            tx,
            { email: `${randomUUID()}@example.com`, ipHash: visitor() },
            { send: box.send, cleanup: false },
          ),
        ),
      ).toEqual({ outcome: "NO_MATCH" });
      expect(await anonymiseWouldWait(customerId)).toBe(false);
    });
  });

  it("checking a code holds the same lock before it makes the session", async () => {
    await withRollback(async (tx) => {
      const customerId = await committedCustomerId(tx);
      const { email } = await addPortalContact(tx, customerId);
      const code = "123456";
      const salt = newCodeSalt();
      await tx.portalCode.create({
        data: {
          email,
          codeHash: hashSignInCode(code, salt),
          salt,
          expiresAt: new Date(Date.now() + 10 * MIN),
        },
      });
      expect(await anonymiseWouldWait(customerId)).toBe(false);
      const ok = await asPortal(tx, () => verifySignInCode(tx, { email, code }));
      expect(ok.outcome).toBe("OK");
      expect(await anonymiseWouldWait(customerId)).toBe(true);
    });
  });

  it("a code request waits while anonymise holds the customer", async () => {
    await expect(
      withRollback(async (tx) => {
        const customerId = await committedCustomerId(tx);
        const { email } = await addPortalContact(tx, customerId);
        await tx.$executeRawUnsafe(LOCK_TIMEOUT);
        const box = mailbox();
        await whileAnonymiseHoldsLock(customerId, () =>
          asPortal(tx, () =>
            requestSignInCode(tx, { email, ipHash: visitor() }, { send: box.send, cleanup: false }),
          ),
        );
      }),
    ).rejects.toSatisfy(isLockTimeout);
  });

  it("after an anonymise, no code is made and a code made just before cannot sign in", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const { number } = await tx.customer.findUniqueOrThrow({
        where: { id: client.customerId },
        select: { number: true },
      });
      await anonymiseCustomer(tx, owner, client.customerId, formatCustomerNumber(number));
      const box = mailbox();
      expect(
        await asPortal(tx, () =>
          requestSignInCode(
            tx,
            { email: client.email, ipHash: visitor() },
            { send: box.send, cleanup: false },
          ),
        ),
      ).toEqual({ outcome: "NO_MATCH" });
      expect(await tx.portalCode.count({ where: { email: client.email } })).toBe(0);
      expect(box.sent).toEqual([]);

      // A code row that slipped in for the old email still gives no session.
      const salt = newCodeSalt();
      await tx.portalCode.create({
        data: {
          email: client.email,
          codeHash: hashSignInCode("654321", salt),
          salt,
          expiresAt: new Date(Date.now() + 10 * MIN),
        },
      });
      expect(
        await asPortal(tx, () => verifySignInCode(tx, { email: client.email, code: "654321" })),
      ).toEqual({ outcome: "INVALID" });
      expect(await tx.portalSession.count({ where: { email: client.email } })).toBe(0);
    });
  });

  it("an anonymise that comes after a sign-in deletes its code and session", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const box = mailbox();
      await asPortal(tx, () =>
        requestSignInCode(
          tx,
          { email: client.email, ipHash: visitor() },
          { send: box.send, cleanup: false },
        ),
      );
      await asPortal(tx, () =>
        requestSignInCode(
          tx,
          { email: client.email, ipHash: visitor() },
          { send: box.send, cleanup: false },
        ),
      );
      const ok = await asPortal(tx, () =>
        verifySignInCode(tx, { email: client.email, code: box.sent[1]!.code }),
      );
      expect(ok.outcome).toBe("OK");
      expect(await tx.portalSession.count({ where: { email: client.email } })).toBe(1);
      expect(await tx.portalCode.count({ where: { email: client.email } })).toBe(1);
      const { number } = await tx.customer.findUniqueOrThrow({
        where: { id: client.customerId },
        select: { number: true },
      });
      await anonymiseCustomer(tx, owner, client.customerId, formatCustomerNumber(number));
      expect(await tx.portalSession.count({ where: { email: client.email } })).toBe(0);
      expect(await tx.portalCode.count({ where: { email: client.email } })).toBe(0);
    });
  });
});
