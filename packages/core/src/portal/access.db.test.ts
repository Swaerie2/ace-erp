import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../customers/access";
import { removeContact, updateContact } from "../customers/contacts";
import { archiveCustomer } from "../customers/customers";
import { contactSchema } from "../customers/schemas";
import { lockCustomer } from "../customers/store";
import type { Prisma } from "../generated/prisma/client";
import { acceptQuote } from "../quotes/outcomes";
import { addDays, todaySA } from "../quotes/reference";
import { findQuote } from "../quotes/store";
import { crew, manager } from "../quotes/test-helpers";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import {
  PORTAL_ACCESS_MESSAGES,
  grantAccessAfterAcceptance,
  grantPortalAccess,
  inviteContact,
  removeContactAccess,
  sendWelcomeEmails,
  type TxRunner,
} from "./access";
import type { EmailMessage } from "./email/send";
import { endPortalSignIns } from "./end-sign-ins";
import { addPortalContact, asPortal, issueFor, makeClient, makeSession } from "./test-helpers";

type Tx = Prisma.TransactionClient;
const SIGN_IN = "https://portal.example.com/sign-in";
const inThisTx =
  (tx: Tx): TxRunner =>
  (fn) =>
    fn(tx);

function outbox() {
  const sent: EmailMessage[] = [];
  return {
    sent,
    deps: {
      send: async (m: EmailMessage) => {
        sent.push(m);
      },
      signInUrl: SIGN_IN,
    },
  };
}
const failing = {
  send: async () => {
    throw new Error("ZZ mail is down");
  },
  signInUrl: SIGN_IN,
};

const staffAccept = (tx: Tx, quoteId: string) =>
  acceptQuote(tx, manager, quoteId, {
    method: "PHONE",
    acceptedBy: "ZZ Staff Recorded",
    startDate: addDays(todaySA(), 3),
    chosenLineIds: [],
  });

const customerAudit = (tx: Tx, customerId: string, action: string) =>
  tx.auditLog.findMany({ where: { entityType: "customer", entityId: customerId, action } });

describe.skipIf(!dbTestsEnabled)("portal access", () => {
  it("after an acceptance gives access to quote contacts with an email who were never invited, and emails them once", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx, { access: false });
      const noQuotes = await addPortalContact(tx, client.customerId, {
        access: false,
        receivesQuotes: false,
      });
      const phoneOnly = await tx.contact.create({
        data: {
          customerId: client.customerId,
          name: "ZZ E2E Phone Only",
          phone: "+27820000001",
          receivesQuotes: true,
        },
        select: { id: true },
      });
      const earlier = new Date("2026-10-01T08:00:00.000Z");
      const removed = await tx.contact.create({
        data: {
          customerId: client.customerId,
          name: "ZZ E2E Removed",
          email: `${randomUUID()}@example.com`,
          receivesQuotes: true,
          portalAccess: false,
          portalInvitedAt: earlier,
        },
        select: { id: true },
      });
      const q = await issueFor(tx, client);
      // Nothing happens before the quote is accepted.
      expect(await grantAccessAfterAcceptance(tx, q)).toEqual([]);

      await staffAccept(tx, q);
      const box = outbox();
      expect(await grantPortalAccess(inThisTx(tx), tx, q, box.deps)).toEqual({
        sent: 1,
        failed: 0,
      });
      expect(box.sent).toHaveLength(1);
      expect(box.sent[0]).toMatchObject({
        to: client.email,
        subject: "Welcome to the ACE client portal",
      });
      expect(box.sent[0]?.text).toContain(SIGN_IN);

      const main = await tx.contact.findUniqueOrThrow({ where: { id: client.contactId } });
      expect(main.portalAccess).toBe(true);
      expect(main.portalInvitedAt).toBeInstanceOf(Date);
      expect(
        (await tx.contact.findUniqueOrThrow({ where: { id: noQuotes.contactId } })).portalAccess,
      ).toBe(false);
      expect(
        (await tx.contact.findUniqueOrThrow({ where: { id: phoneOnly.id } })).portalAccess,
      ).toBe(false);
      const stillRemoved = await tx.contact.findUniqueOrThrow({ where: { id: removed.id } });
      expect(stillRemoved).toMatchObject({ portalAccess: false, portalInvitedAt: earlier });

      const granted = await customerAudit(tx, client.customerId, "customer.portal_access_granted");
      expect(granted).toHaveLength(1);
      expect(granted[0]).toMatchObject({ actorType: "SYSTEM", actorId: null });
      expect(granted[0]?.after).toEqual({ contactId: client.contactId, via: "acceptance" });
      const sent = await customerAudit(tx, client.customerId, "portal.invite_sent");
      expect(sent).toHaveLength(1);
      expect(sent[0]?.after).toEqual({ contactId: client.contactId });
      const text = JSON.stringify([...granted, ...sent]);
      expect(text).not.toContain(client.email);
      expect(text).not.toContain(main.name);

      // Running it again finds nobody new and sends nothing.
      expect(await grantPortalAccess(inThisTx(tx), tx, q, box.deps)).toEqual({
        sent: 0,
        failed: 0,
      });
      expect(box.sent).toHaveLength(1);
      expect((await findQuote(tx, q)).status).toBe("ACCEPTED");
    });
  });

  it("notes an email failure without undoing the acceptance or the access, and works as ace_portal", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx, { access: false });
      const q = await issueFor(tx, client);
      await staffAccept(tx, q);
      const invites = await asPortal(tx, () => grantAccessAfterAcceptance(tx, q));
      expect(invites.map((i) => i.contactId)).toEqual([client.contactId]);
      expect(await asPortal(tx, () => sendWelcomeEmails(tx, invites, failing))).toEqual({
        sent: 0,
        failed: 1,
      });
      expect((await findQuote(tx, q)).status).toBe("ACCEPTED");
      expect(
        (await tx.contact.findUniqueOrThrow({ where: { id: client.contactId } })).portalAccess,
      ).toBe(true);
      const failed = await customerAudit(tx, client.customerId, "portal.invite_failed");
      expect(failed).toHaveLength(1);
      expect(failed[0]?.after).toEqual({ contactId: client.contactId });
      expect(JSON.stringify(failed)).not.toContain("ZZ mail is down");
      expect(JSON.stringify(failed)).not.toContain(client.email);
    });
  });

  it("gives nobody access on an acceptance of an archived customer's quote", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx, { access: false });
      const q = await issueFor(tx, client);
      await staffAccept(tx, q);
      await archiveCustomer(tx, manager, client.customerId);
      const box = outbox();
      expect(await asPortal(tx, () => grantPortalAccess(inThisTx(tx), tx, q, box.deps))).toEqual({
        sent: 0,
        failed: 0,
      });
      expect(box.sent).toEqual([]);
      expect(
        (await tx.contact.findUniqueOrThrow({ where: { id: client.contactId } })).portalAccess,
      ).toBe(false);
    });
  });

  it("lets staff invite a contact, and refuses crew, a contact with no email and an archived customer", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx, { access: false });
      const name = (await tx.contact.findUniqueOrThrow({ where: { id: client.contactId } })).name;
      expect(await inviteContact(tx, manager, client.contactId)).toEqual({
        contactId: client.contactId,
        customerId: client.customerId,
        email: client.email,
        name,
      });
      const row = await tx.contact.findUniqueOrThrow({ where: { id: client.contactId } });
      expect(row.portalAccess).toBe(true);
      expect(row.portalInvitedAt).toBeInstanceOf(Date);
      const invited = await customerAudit(tx, client.customerId, "customer.portal_invited");
      expect(invited[0]).toMatchObject({ actorType: "STAFF", actorId: manager.id });
      expect(invited[0]?.after).toEqual({ contactId: client.contactId });

      await expect(inviteContact(tx, crew, client.contactId)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      const phoneOnly = await tx.contact.create({
        data: { customerId: client.customerId, name: "ZZ E2E Phone Only", phone: "+27820000002" },
        select: { id: true },
      });
      await expect(inviteContact(tx, manager, phoneOnly.id)).rejects.toThrow(
        PORTAL_ACCESS_MESSAGES.noEmail,
      );
      await expect(inviteContact(tx, manager, randomUUID())).rejects.toThrow(
        PORTAL_ACCESS_MESSAGES.missing,
      );
      const other = await makeClient(tx, { access: false });
      await archiveCustomer(tx, manager, other.customerId);
      await expect(inviteContact(tx, manager, other.contactId)).rejects.toThrow(
        PORTAL_ACCESS_MESSAGES.archived,
      );

      // Staff may deliberately invite a removed person again.
      await removeContactAccess(tx, manager, client.contactId);
      await inviteContact(tx, manager, client.contactId);
      expect(
        (await tx.contact.findUniqueOrThrow({ where: { id: client.contactId } })).portalAccess,
      ).toBe(true);
    });
  });

  it("ends an email's sign-ins on removal only when no other contact with it has access, and never re-grants it", async () => {
    await withRollback(async (tx) => {
      const email = `${randomUUID()}@example.com`;
      const a = await makeClient(tx, { email });
      const b = await makeClient(tx, { email });
      await makeSession(tx, email);
      await tx.portalCode.create({
        data: {
          email,
          codeHash: "0".repeat(64),
          salt: "0".repeat(32),
          expiresAt: new Date(Date.now() + 600_000),
        },
      });
      await expect(removeContactAccess(tx, crew, a.contactId)).rejects.toBeInstanceOf(
        ForbiddenError,
      );

      await removeContactAccess(tx, manager, a.contactId);
      const rowA = await tx.contact.findUniqueOrThrow({ where: { id: a.contactId } });
      expect(rowA.portalAccess).toBe(false);
      expect(rowA.portalInvitedAt).toBeInstanceOf(Date);
      expect(await tx.portalSession.count({ where: { email } })).toBe(1);
      expect(
        (await customerAudit(tx, a.customerId, "customer.portal_access_removed"))[0]?.after,
      ).toEqual({
        contactId: a.contactId,
        signInsEnded: false,
      });

      await removeContactAccess(tx, manager, b.contactId);
      expect(await tx.portalSession.count({ where: { email } })).toBe(0);
      expect(await tx.portalCode.count({ where: { email } })).toBe(0);
      expect(
        (await customerAudit(tx, b.customerId, "customer.portal_access_removed"))[0]?.after,
      ).toEqual({
        contactId: b.contactId,
        signInsEnded: true,
      });

      // A contact given access before invitation dates were kept (the old contact-form tick) has access
      // but no invitation date. Removing its access must still stop the next acceptance re-granting it.
      const legacy = await tx.contact.create({
        data: {
          customerId: a.customerId,
          name: "ZZ E2E Legacy Access",
          email: `${randomUUID()}@example.com`,
          receivesQuotes: true,
          portalAccess: true,
          portalInvitedAt: null,
        },
        select: { id: true },
      });
      await removeContactAccess(tx, manager, legacy.id);
      const legacyRow = await tx.contact.findUniqueOrThrow({ where: { id: legacy.id } });
      expect(legacyRow.portalAccess).toBe(false);
      expect(legacyRow.portalInvitedAt).toBeInstanceOf(Date);

      // A later acceptance does not give access back to someone who was removed.
      const q = await issueFor(tx, a);
      await staffAccept(tx, q);
      const box = outbox();
      expect(await grantPortalAccess(inThisTx(tx), tx, q, box.deps)).toEqual({
        sent: 0,
        failed: 0,
      });
      expect(box.sent).toEqual([]);
      expect(
        (await tx.contact.findUniqueOrThrow({ where: { id: a.contactId } })).portalAccess,
      ).toBe(false);
      expect((await tx.contact.findUniqueOrThrow({ where: { id: legacy.id } })).portalAccess).toBe(
        false,
      );
      expect(await customerAudit(tx, a.customerId, "customer.portal_access_granted")).toEqual([]);
    });
  });

  it("ends the old email's sign-ins when a contact is removed or changes email", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const extra = await addPortalContact(tx, client.customerId);
      await makeSession(tx, extra.email);
      await removeContact(tx, manager, extra.contactId);
      expect(await tx.portalSession.count({ where: { email: extra.email } })).toBe(0);

      await makeSession(tx, client.email);
      const newEmail = `${randomUUID()}@example.com`;
      await updateContact(
        tx,
        manager,
        client.contactId,
        contactSchema.parse({ name: "ZZ E2E Renamed", email: newEmail, receivesQuotes: "on" }),
      );
      expect(await tx.portalSession.count({ where: { email: client.email } })).toBe(0);

      // A change that keeps the email keeps the sign-ins.
      await makeSession(tx, newEmail);
      await updateContact(
        tx,
        manager,
        client.contactId,
        contactSchema.parse({
          name: "ZZ E2E Renamed Again",
          email: newEmail,
          receivesQuotes: "on",
        }),
      );
      expect(await tx.portalSession.count({ where: { email: newEmail } })).toBe(1);
    });
  });

  it("switches portal access off when a contact's email changes, keeping the invitation date", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const before = await tx.contact.findUniqueOrThrow({ where: { id: client.contactId } });
      expect(before.portalAccess).toBe(true);
      expect(before.portalWelcomedAt).not.toBeNull();
      await makeSession(tx, client.email);
      const newEmail = `${randomUUID()}@example.com`;
      const result = await updateContact(
        tx,
        manager,
        client.contactId,
        contactSchema.parse({ name: before.name, email: newEmail, receivesQuotes: "on" }),
      );
      expect(result).toEqual({ portalSwitchedOff: true });
      const after = await tx.contact.findUniqueOrThrow({ where: { id: client.contactId } });
      expect(after.email).toBe(newEmail);
      expect(after.portalAccess).toBe(false);
      expect(after.portalWelcomedAt).toBeNull();
      // Kept, so a later acceptance never gives the access back on its own.
      expect(after.portalInvitedAt).toEqual(before.portalInvitedAt);
      expect(await tx.portalSession.count({ where: { email: client.email } })).toBe(0);
      expect(await tx.portalCode.count({ where: { email: client.email } })).toBe(0);
    });
  });

  it("leaves portal access alone when the email is unchanged, and for a contact without access", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const before = await tx.contact.findUniqueOrThrow({ where: { id: client.contactId } });
      await makeSession(tx, client.email);
      const same = await updateContact(
        tx,
        manager,
        client.contactId,
        contactSchema.parse({ name: "ZZ E2E Renamed", email: client.email, receivesQuotes: "on" }),
      );
      expect(same).toEqual({ portalSwitchedOff: false });
      const after = await tx.contact.findUniqueOrThrow({ where: { id: client.contactId } });
      expect(after.name).toBe("ZZ E2E Renamed");
      expect(after.portalAccess).toBe(true);
      expect(after.portalWelcomedAt).toEqual(before.portalWelcomedAt);
      expect(after.portalInvitedAt).toEqual(before.portalInvitedAt);
      expect(await tx.portalSession.count({ where: { email: client.email } })).toBe(1);

      // Never invited: a new email gives no access and no invitation date.
      const other = await addPortalContact(tx, client.customerId, { access: false });
      const moved = await updateContact(
        tx,
        manager,
        other.contactId,
        contactSchema.parse({
          name: "ZZ E2E Other",
          email: `${randomUUID()}@example.com`,
          receivesQuotes: "on",
        }),
      );
      expect(moved).toEqual({ portalSwitchedOff: false });
      const row = await tx.contact.findUniqueOrThrow({ where: { id: other.contactId } });
      expect(row.portalAccess).toBe(false);
      expect(row.portalInvitedAt).toBeNull();
      expect(row.portalWelcomedAt).toBeNull();
    });
  });

  it("keeps sign-ins only for a shared email that still has access on a live customer", async () => {
    await withRollback(async (tx) => {
      const shared = `${randomUUID()}@example.com`;
      const a = await makeClient(tx, { email: shared });
      const live = await makeClient(tx);
      await addPortalContact(tx, live.customerId, { email: shared });
      await makeSession(tx, shared);
      // Another live customer's contact with the same email still has access: nobody is signed out.
      expect(await endPortalSignIns(tx, [shared], [a.contactId])).toBe(0);
      expect(await tx.portalSession.count({ where: { email: shared } })).toBe(1);

      // The other contact's customer is archived: that access no longer counts.
      await tx.customer.update({
        where: { id: live.customerId },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });
      expect(await endPortalSignIns(tx, [shared], [a.contactId])).toBe(1);
      expect(await tx.portalSession.count({ where: { email: shared } })).toBe(0);

      // Restored: it counts again. Anonymised: it does not.
      await tx.customer.update({
        where: { id: live.customerId },
        data: { status: "ACTIVE", archivedAt: null },
      });
      await makeSession(tx, shared);
      expect(await endPortalSignIns(tx, [shared], [a.contactId])).toBe(0);
      await tx.customer.update({
        where: { id: live.customerId },
        data: { anonymisedAt: new Date() },
      });
      expect(await endPortalSignIns(tx, [shared], [a.contactId])).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Ending sign-ins against a concurrent sign-in.
//
// Sign-in share-locks the customer row before it writes a code or a session (signin.ts). Removing access,
// removing a contact and changing a contact's email must therefore take the customer lock BEFORE they
// delete the email's codes and sessions: if a sign-in got there first, the removal then waits for it to
// commit, and its delete (a later statement) sees and removes the new row. These tests hold the customer
// lock on a second connection (always rolled back) against a COMMITTED customer of the dev database (a
// made-up contact is added inside the test transaction, never committed), start the operation, and, while
// it is blocked, read `pg_locks` for its connection: it must be waiting, and must not yet have touched
// `portal_sessions` or `portal_codes` (a DELETE takes a table lock on them that stays until the end).
// ---------------------------------------------------------------------------------------------------------

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

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Holds the customer's lock on another connection, starts `run` (on `tx`), waits until `tx`'s connection is
 * blocked, notes which sign-in tables it has touched by then, and releases the lock so `run` can finish.
 */
async function whileCustomerHeld(
  tx: Tx,
  customerId: string,
  run: () => Promise<unknown>,
): Promise<{ waited: boolean; touched: string[]; touchedAtEnd: string[] }> {
  const [me] = await tx.$queryRaw<{ pid: number }[]>`select pg_backend_pid() as pid`;
  const pid = me?.pid;
  if (pid === undefined) throw new Error("Could not read the test connection's id.");
  // A safety net: never wait for ever if something goes wrong.
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '20s'`);
  let pending: Promise<unknown> = Promise.resolve();
  const seen = await withRollback(async (other) => {
    await other.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
    await lockCustomer(other, customerId);
    pending = run();
    pending.catch(() => undefined);
    let waited = false;
    for (let i = 0; i < 100 && !waited; i += 1) {
      const rows = await other.$queryRaw<{ n: number }[]>`
        select count(*)::int as n from pg_locks where pid = ${pid} and not granted`;
      waited = (rows[0]?.n ?? 0) > 0;
      if (!waited) await pause(100);
    }
    return { waited, touched: await signInTablesTouched(other, pid) };
  });
  // The other connection has rolled back, so the lock is free and `run` can finish.
  await pending;
  return { ...seen, touchedAtEnd: await signInTablesTouched(tx, pid) };
}

/** Which of the sign-in tables the connection `pid` holds a lock on (any statement on them takes one). */
async function signInTablesTouched(store: Tx, pid: number): Promise<string[]> {
  const rows = await store.$queryRaw<{ relname: string }[]>`
    select distinct c.relname::text as relname
      from pg_locks l join pg_class c on c.oid = l.relation
     where l.pid = ${pid} and l.granted and c.relname in ('portal_sessions', 'portal_codes')
     order by 1`;
  return rows.map((r) => r.relname);
}

const ENDED = ["portal_codes", "portal_sessions"];

describe.skipIf(!dbTestsEnabled)("ending portal sign-ins takes the customer lock first", () => {
  it("the check notices sign-ins ended before the customer lock (control)", async () => {
    await withRollback(async (tx) => {
      const customerId = await committedCustomerId(tx);
      const { contactId, email } = await addPortalContact(tx, customerId);
      const seen = await whileCustomerHeld(tx, customerId, async () => {
        expect(await endPortalSignIns(tx, [email], [contactId])).toBe(1);
        await lockCustomer(tx, customerId);
      });
      expect(seen).toEqual({ waited: true, touched: ENDED, touchedAtEnd: ENDED });
    });
  });

  it("removing access waits for the customer before it ends sign-ins", async () => {
    await withRollback(async (tx) => {
      const customerId = await committedCustomerId(tx);
      const { contactId } = await addPortalContact(tx, customerId);
      const seen = await whileCustomerHeld(tx, customerId, () =>
        removeContactAccess(tx, manager, contactId),
      );
      expect(seen).toEqual({ waited: true, touched: [], touchedAtEnd: ENDED });
      const row = await tx.contact.findUniqueOrThrow({
        where: { id: contactId },
        select: { portalAccess: true },
      });
      expect(row.portalAccess).toBe(false);
    });
  });

  it("removing a contact waits for the customer before it ends sign-ins", async () => {
    await withRollback(async (tx) => {
      const customerId = await committedCustomerId(tx);
      const { contactId } = await addPortalContact(tx, customerId);
      const seen = await whileCustomerHeld(tx, customerId, () =>
        removeContact(tx, manager, contactId),
      );
      expect(seen).toEqual({ waited: true, touched: [], touchedAtEnd: ENDED });
      expect(await tx.contact.count({ where: { id: contactId } })).toBe(0);
    });
  });

  it("changing a contact's email waits for the customer before it ends sign-ins", async () => {
    await withRollback(async (tx) => {
      const customerId = await committedCustomerId(tx);
      const { contactId } = await addPortalContact(tx, customerId, { name: "ZZ E2E Mover" });
      const newEmail = `${randomUUID()}@example.com`;
      const seen = await whileCustomerHeld(tx, customerId, () =>
        updateContact(
          tx,
          manager,
          contactId,
          contactSchema.parse({ name: "ZZ E2E Mover", email: newEmail, receivesQuotes: "on" }),
        ),
      );
      expect(seen).toEqual({ waited: true, touched: [], touchedAtEnd: ENDED });
      const row = await tx.contact.findUniqueOrThrow({
        where: { id: contactId },
        select: { email: true },
      });
      expect(row.email).toBe(newEmail);
    });
  });
});
