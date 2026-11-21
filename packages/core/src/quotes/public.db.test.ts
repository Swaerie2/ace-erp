import { describe, expect, it } from "vitest";
import { hashIp } from "./bots";
import { createQuote } from "./drafts";
import { issueQuote, reviseQuote, withdrawQuote } from "./issue";
import { revokeQuoteLink } from "./link";
import { acceptQuote } from "./outcomes";
import {
  acceptViaLink,
  checkRateLimit,
  declineViaLink,
  getPublicQuote,
  recordLinkView,
} from "./public";
import { addDays, fromDateString, todaySA } from "./reference";
import { acceptSchema } from "./schemas";
import { findQuote } from "./store";
import {
  fillDraft,
  makeCustomer,
  makeIssued,
  manager,
  monthlyLine,
  optionalLine,
} from "./test-helpers";
import { dbTestsEnabled, withRollback } from "../testing/rollback";

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];

const ctx = { ip: "203.0.113.9", userAgent: "Test Browser" };
const start = () => addDays(todaySA(), 4);
const yesterday = () => fromDateString(addDays(todaySA(), -1));
const tokenOf = async (tx: Tx, id: string) => (await findQuote(tx, id)).linkToken ?? "";

// Each makeIssued() takes about 10 seconds on the dev database and a test has 150 seconds, so no test
// below issues more than three quotes.

describe.skipIf(!dbTestsEnabled)("looking a quote up by its private code", () => {
  it("shows an open quote with the name and address but no email, phone or internal note", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx, { draft: { internalNote: "Gate code 1234" } });
      const result = await getPublicQuote(tx, await tokenOf(tx, q.id));
      expect(result.found).toBe(true);
      if (!result.found) return;
      expect(result.state).toBe("OPEN");
      expect(result.reference).toMatch(/^QUO-\d{4}-\d{4,}$/);
      expect(result.doc.preparedFor.name).toBe(q.contactName);
      expect(result.doc.preparedFor.siteAddress).toContain("1 Quote Street");
      expect(result.doc.preparedFor.email).toBeNull();
      expect(result.doc.preparedFor.phone).toBeNull();
      const text = JSON.stringify(result);
      expect(text).not.toContain("Gate code 1234");
      expect(text).not.toContain("@example.com");
      expect(result.business.email).toContain("@");
    });
  });

  it("gives the same 'not found' for a wrong, malformed, revoked and unknown code", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      const token = await tokenOf(tx, q.id);
      await revokeQuoteLink(tx, manager, q.id);
      const results = await Promise.all([
        getPublicQuote(tx, token), // revoked
        getPublicQuote(tx, "A".repeat(43)), // well formed but unknown
        getPublicQuote(tx, "short"), // malformed
        getPublicQuote(tx, ""),
      ]);
      for (const r of results) expect(r).toEqual({ found: false });

      // The revoked code also refuses to accept or decline, and a view of it records nothing.
      const input = { acceptedBy: "A", startDate: start(), chosenLineIds: [] };
      expect(await acceptViaLink(tx, token, input, ctx)).toEqual({ outcome: "NOT_FOUND" });
      expect(await declineViaLink(tx, token, {}, ctx)).toEqual({ outcome: "NOT_FOUND" });
      await recordLinkView(tx, token);
      expect(await findQuote(tx, q.id)).toMatchObject({
        status: "ISSUED",
        firstViewedAt: null,
        lastViewedAt: null,
      });
    });
  });

  it("reports an expired quote as expired", async () => {
    await withRollback(async (tx) => {
      const expired = await makeIssued(tx);
      await tx.quote.update({ where: { id: expired.id }, data: { validUntil: yesterday() } });
      const e = await getPublicQuote(tx, await tokenOf(tx, expired.id));
      expect(e.found && e.state).toBe("EXPIRED");
    });
  });

  it("reports an accepted quote as accepted, with who accepted it", async () => {
    await withRollback(async (tx) => {
      const accepted = await makeIssued(tx);
      await acceptQuote(
        tx,
        manager,
        accepted.id,
        acceptSchema.parse({
          method: "PHONE",
          acceptedBy: "A. Client",
          startDate: start(),
          chosenLineIds: [],
        }),
      );
      const a = await getPublicQuote(tx, await tokenOf(tx, accepted.id));
      expect(a.found && a.state).toBe("ACCEPTED");
      expect(a.found && a.acceptance?.name).toBe("A. Client");
    });
  });

  it("reports a withdrawn quote as withdrawn", async () => {
    await withRollback(async (tx) => {
      const withdrawn = await makeIssued(tx);
      const wToken = await tokenOf(tx, withdrawn.id);
      await withdrawQuote(tx, manager, withdrawn.id);
      const w = await getPublicQuote(tx, wToken);
      expect(w.found && w.state).toBe("WITHDRAWN");
    });
  });

  it("reports a replaced quote as replaced and points to the newer code", async () => {
    await withRollback(async (tx) => {
      const original = await makeIssued(tx);
      const oldToken = await tokenOf(tx, original.id);
      const { id: draft } = await reviseQuote(tx, manager, original.id);
      await issueQuote(tx, manager, draft);
      const r = await getPublicQuote(tx, oldToken);
      expect(r.found && r.state).toBe("REPLACED");
      expect(r.found && r.newerToken).toBe(await tokenOf(tx, draft));
    });
  });

  it("records the first and last view, only for a live link on a viewable quote", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      const token = await tokenOf(tx, q.id);
      const t1 = new Date("2026-11-21T10:00:00Z");
      const t2 = new Date("2026-11-21T11:00:00Z");
      await recordLinkView(tx, token, t1);
      await recordLinkView(tx, token, t2);
      const row = await findQuote(tx, q.id);
      expect(row.firstViewedAt?.toISOString()).toBe(t1.toISOString());
      expect(row.lastViewedAt?.toISOString()).toBe(t2.toISOString());

      const w = await makeIssued(tx);
      const wToken = await tokenOf(tx, w.id);
      await withdrawQuote(tx, manager, w.id);
      await recordLinkView(tx, wToken);
      expect((await findQuote(tx, w.id)).lastViewedAt).toBeNull();

      await recordLinkView(tx, "A".repeat(43)); // unknown: nothing happens, no error
    });
  });
});

describe.skipIf(!dbTestsEnabled)("accepting and declining on the link", () => {
  it("accepts with the chosen add-ons and activates a lead", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx, "LEAD");
      const { id } = await createQuote(tx, manager, c);
      await fillDraft(tx, id, { lines: [monthlyLine(), optionalLine()] });
      await issueQuote(tx, manager, id);
      const row = await findQuote(tx, id);
      const optionId = row.lines[1]?.id ?? "";
      const result = await acceptViaLink(
        tx,
        row.linkToken ?? "",
        { acceptedBy: "A. Client", startDate: start(), chosenLineIds: [optionId] },
        ctx,
      );
      expect(result).toEqual({ outcome: "ACCEPTED", customerFlag: null });
      const after = await findQuote(tx, id);
      expect(after).toMatchObject({
        status: "ACCEPTED",
        acceptedMethod: "CLIENT_LINK",
        acceptedByStaffId: null,
        acceptedIp: ctx.ip,
      });
      expect(after.lines.map((l) => l.chosen)).toEqual([false, true]);
      expect((await tx.customer.findUniqueOrThrow({ where: { id: c.customerId } })).status).toBe(
        "ACTIVE",
      );
    });
  });

  it("refuses a past start date and a line that is not an optional add-on, with plain messages", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      const row = await findQuote(tx, q.id);
      await expect(
        acceptViaLink(
          tx,
          row.linkToken ?? "",
          { acceptedBy: "A", startDate: addDays(todaySA(), -1), chosenLineIds: [] },
          ctx,
        ),
      ).rejects.toThrow("The start date must be today or later.");
      await expect(
        acceptViaLink(
          tx,
          row.linkToken ?? "",
          { acceptedBy: "A", startDate: start(), chosenLineIds: [row.lines[0]?.id ?? ""] },
          ctx,
        ),
      ).rejects.toThrow("Only optional add-ons can be chosen.");
    });
  });

  it("answers a repeat, an expired and an unknown code without recording a second acceptance", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      const token = await tokenOf(tx, q.id);
      const input = { acceptedBy: "A", startDate: start(), chosenLineIds: [] };
      expect((await acceptViaLink(tx, token, input, ctx)).outcome).toBe("ACCEPTED");
      expect((await acceptViaLink(tx, token, input, ctx)).outcome).toBe("ALREADY_ACCEPTED");
      expect(await tx.auditLog.count({ where: { entityId: q.id, action: "quote.accepted" } })).toBe(
        1,
      );

      const old = await makeIssued(tx);
      const oldToken = await tokenOf(tx, old.id);
      await tx.quote.update({ where: { id: old.id }, data: { validUntil: yesterday() } });
      expect((await acceptViaLink(tx, oldToken, input, ctx)).outcome).toBe("EXPIRED");

      expect((await acceptViaLink(tx, "A".repeat(43), input, ctx)).outcome).toBe("NOT_FOUND");
    });
  });

  it("refuses to accept a withdrawn quote", async () => {
    await withRollback(async (tx) => {
      const w = await makeIssued(tx);
      const wToken = await tokenOf(tx, w.id);
      await withdrawQuote(tx, manager, w.id);
      const input = { acceptedBy: "A", startDate: start(), chosenLineIds: [] };
      expect((await acceptViaLink(tx, wToken, input, ctx)).outcome).toBe("NOT_AVAILABLE");
    });
  });

  it("flags a paused customer and leaves them unchanged", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx, { status: "ACTIVE" });
      await tx.customer.update({ where: { id: q.customerId }, data: { status: "PAUSED" } });
      const result = await acceptViaLink(
        tx,
        await tokenOf(tx, q.id),
        { acceptedBy: "A", startDate: start(), chosenLineIds: [] },
        ctx,
      );
      expect(result).toEqual({ outcome: "ACCEPTED", customerFlag: "PAUSED" });
      expect((await tx.customer.findUniqueOrThrow({ where: { id: q.customerId } })).status).toBe(
        "PAUSED",
      );
    });
  });

  it("declines with a reason, marks it as the client's decline, and refuses a second decline", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx, { status: "LEAD" });
      const token = await tokenOf(tx, q.id);
      expect(await declineViaLink(tx, token, { reason: "Too dear" }, ctx)).toEqual({
        outcome: "DECLINED",
      });
      expect(await findQuote(tx, q.id)).toMatchObject({
        status: "DECLINED",
        declinedByClient: true,
        declineReason: "Too dear",
      });
      expect((await tx.customer.findUniqueOrThrow({ where: { id: q.customerId } })).status).toBe(
        "LEAD",
      );
      expect(await declineViaLink(tx, token, {}, ctx)).toEqual({ outcome: "ALREADY_DECLINED" });
      expect(await declineViaLink(tx, "short", {}, ctx)).toEqual({ outcome: "NOT_FOUND" });
    });
  });

  it("refuses to decline a quote that was already accepted", async () => {
    await withRollback(async (tx) => {
      const a = await makeIssued(tx);
      const aToken = await tokenOf(tx, a.id);
      await acceptViaLink(
        tx,
        aToken,
        { acceptedBy: "A", startDate: start(), chosenLineIds: [] },
        ctx,
      );
      expect((await declineViaLink(tx, aToken, {}, ctx)).outcome).toBe("NOT_AVAILABLE");
    });
  });

  it("writes only fixed words to the audit log, with the customer as the actor", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      await acceptViaLink(
        tx,
        await tokenOf(tx, q.id),
        { acceptedBy: "Secret Name", startDate: start(), chosenLineIds: [] },
        ctx,
      );
      const audit = await tx.auditLog.findMany({
        where: { entityId: q.id, action: "quote.accepted" },
      });
      expect(audit[0]).toMatchObject({
        actorType: "CUSTOMER",
        actorId: q.customerId,
        ip: null,
        userAgent: null,
      });
      const text = JSON.stringify(audit);
      expect(text).not.toContain("Secret Name");
      expect(text).not.toContain(ctx.ip);
      expect(text).not.toContain(ctx.userAgent);
      expect(text).not.toContain(await tokenOf(tx, q.id));
    });
  });
});

describe.skipIf(!dbTestsEnabled)("the rate limiter", () => {
  it("allows up to the limit in a window, then refuses, with separate buckets and windows", async () => {
    await withRollback(async (tx) => {
      const ip = hashIp("198.51.100.1");
      const now = new Date("2026-11-21T10:03:00Z");
      for (let i = 0; i < 10; i++) {
        expect((await checkRateLimit(tx, "act", ip, { now })).allowed).toBe(true);
      }
      expect((await checkRateLimit(tx, "act", ip, { now })).allowed).toBe(false);
      // views are a separate bucket with a bigger allowance
      expect((await checkRateLimit(tx, "view", ip, { now })).allowed).toBe(true);
      // another visitor is unaffected
      expect((await checkRateLimit(tx, "act", hashIp("198.51.100.2"), { now })).allowed).toBe(true);
      // the next window starts fresh
      expect(
        (await checkRateLimit(tx, "act", ip, { now: new Date("2026-11-21T10:10:30Z") })).allowed,
      ).toBe(true);
    });
  });

  it("clears windows older than a day when it cleans up, and never stores the address", async () => {
    await withRollback(async (tx) => {
      const ip = "198.51.100.77";
      const hashed = hashIp(ip);
      await checkRateLimit(tx, "view", hashed, { now: new Date("2026-11-01T10:00:00Z") });
      await checkRateLimit(tx, "view", hashed, {
        now: new Date("2026-11-21T10:00:00Z"),
        cleanup: true,
      });
      const rows = await tx.publicLinkHit.findMany({ where: { bucket: `view:${hashed}` } });
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain(ip);
    });
  });
});
