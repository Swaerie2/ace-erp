import { describe, expect, it } from "vitest";
import { clientParty, staffParty } from "../audit";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import {
  acceptCore,
  declineCore,
  LinkNoLongerValidError,
  QuoteExpiredError,
  QuoteNotIssuedError,
} from "./acceptance";
import { createQuoteLink } from "./link";
import { addDays, fromDateString, todaySA } from "./reference";
import { findQuote } from "./store";
import { makeIssued, manager } from "./test-helpers";

const start = () => addDays(todaySA(), 5);
const clientCtx = (customerId: string) => ({
  audit: clientParty(customerId),
  method: "CLIENT_LINK" as const,
  staffId: null,
  ip: "203.0.113.7",
  userAgent: "Test Browser",
});

describe.skipIf(!dbTestsEnabled)("the shared acceptance routine", () => {
  it("records a client acceptance with the proof, no staff id, and a CUSTOMER audit line without the visitor's details", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx, { status: "LEAD" });
      const result = await acceptCore(tx, clientCtx(q.customerId), q.id, {
        acceptedBy: "A. Client",
        startDate: start(),
        chosenLineIds: [],
      });
      expect(result.customerFlag).toBeNull();
      const row = await findQuote(tx, q.id);
      expect(row).toMatchObject({
        status: "ACCEPTED",
        acceptedMethod: "CLIENT_LINK",
        acceptedByName: "A. Client",
        acceptedByStaffId: null,
        acceptedIp: "203.0.113.7",
        acceptedUserAgent: "Test Browser",
      });
      expect((await tx.customer.findUniqueOrThrow({ where: { id: q.customerId } })).status).toBe(
        "ACTIVE",
      );

      const audit = await tx.auditLog.findMany({
        where: { entityId: q.id, action: "quote.accepted" },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actorType: "CUSTOMER",
        actorId: q.customerId,
        ip: null,
        userAgent: null,
      });
      const text = JSON.stringify(audit);
      expect(text).not.toContain("A. Client");
      expect(text).not.toContain("203.0.113.7");
      expect(text).not.toContain("Test Browser");
      const activation = await tx.auditLog.findMany({
        where: { entityId: q.customerId, action: "customer.activated" },
      });
      expect(activation[0]).toMatchObject({ actorType: "CUSTOMER" });
      expect(activation[0]?.after).toEqual({ from: "LEAD", via: "quote" });
    });
  });

  it("reports a repeat as 'not issued' with the current status, and an expired quote as expired", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      await acceptCore(tx, clientCtx(q.customerId), q.id, {
        acceptedBy: "A",
        startDate: start(),
        chosenLineIds: [],
      });
      const repeat = await acceptCore(tx, clientCtx(q.customerId), q.id, {
        acceptedBy: "A",
        startDate: start(),
        chosenLineIds: [],
      }).catch((e: unknown) => e);
      expect(repeat).toBeInstanceOf(QuoteNotIssuedError);
      expect((repeat as QuoteNotIssuedError).status).toBe("ACCEPTED");

      const old = await makeIssued(tx);
      await tx.quote.update({
        where: { id: old.id },
        data: { validUntil: fromDateString(addDays(todaySA(), -1)) },
      });
      await expect(
        acceptCore(tx, clientCtx(old.customerId), old.id, {
          acceptedBy: "A",
          startDate: start(),
          chosenLineIds: [],
        }),
      ).rejects.toBeInstanceOf(QuoteExpiredError);
    });
  });

  it("works for a staff party exactly as before (staff id kept, STAFF audit line)", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx, { status: "ACTIVE" });
      await acceptCore(
        tx,
        {
          audit: staffParty(manager),
          method: "PHONE",
          staffId: manager.id,
          ip: null,
          userAgent: null,
        },
        q.id,
        { acceptedBy: "A. Client", startDate: start(), chosenLineIds: [], note: "n" },
      );
      expect(await findQuote(tx, q.id)).toMatchObject({
        acceptedMethod: "PHONE",
        acceptedByStaffId: manager.id,
      });
      const audit = await tx.auditLog.findMany({
        where: { entityId: q.id, action: "quote.accepted" },
      });
      expect(audit[0]).toMatchObject({ actorType: "STAFF", actorId: manager.id });
    });
  });

  it("records a client decline with the flag, and a lead stays a lead", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx, { status: "LEAD" });
      await declineCore(tx, { audit: clientParty(q.customerId), declinedByClient: true }, q.id, {
        reason: "Too dear",
      });
      expect(await findQuote(tx, q.id)).toMatchObject({
        status: "DECLINED",
        declinedByClient: true,
        declineReason: "Too dear",
      });
      expect((await tx.customer.findUniqueOrThrow({ where: { id: q.customerId } })).status).toBe(
        "LEAD",
      );
      const audit = await tx.auditLog.findMany({
        where: { entityId: q.id, action: "quote.declined" },
      });
      expect(audit[0]).toMatchObject({ actorType: "CUSTOMER", ip: null });
      expect(JSON.stringify(audit)).not.toContain("Too dear");
      await expect(
        declineCore(tx, { audit: clientParty(q.customerId), declinedByClient: true }, q.id, {}),
      ).rejects.toBeInstanceOf(QuoteNotIssuedError);
    });
  });

  it("refuses a request found by a link code that is no longer the quote's current one, and changes nothing", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx, { status: "LEAD" });
      const oldToken = (await findQuote(tx, q.id)).linkToken ?? "";
      const next = await createQuoteLink(tx, manager, q.id, { replace: true });
      const input = { acceptedBy: "A. Client", startDate: start(), chosenLineIds: [] };

      await expect(
        acceptCore(tx, { ...clientCtx(q.customerId), expectLinkToken: oldToken }, q.id, input),
      ).rejects.toBeInstanceOf(LinkNoLongerValidError);
      await expect(
        declineCore(
          tx,
          { audit: clientParty(q.customerId), declinedByClient: true, expectLinkToken: oldToken },
          q.id,
          {},
        ),
      ).rejects.toBeInstanceOf(LinkNoLongerValidError);
      expect(await findQuote(tx, q.id)).toMatchObject({ status: "ISSUED", acceptedAt: null });
      expect(
        await tx.auditLog.count({
          where: { entityId: q.id, action: { in: ["quote.accepted", "quote.declined"] } },
        }),
      ).toBe(0);

      // A revoked link (no code at all) is refused the same way; the current code still works.
      await tx.quote.update({
        where: { id: q.id },
        data: { linkToken: null },
        select: { id: true },
      });
      await expect(
        acceptCore(tx, { ...clientCtx(q.customerId), expectLinkToken: next.token }, q.id, input),
      ).rejects.toBeInstanceOf(LinkNoLongerValidError);
      await tx.quote.update({
        where: { id: q.id },
        data: { linkToken: next.token },
        select: { id: true },
      });
      const done = await acceptCore(
        tx,
        { ...clientCtx(q.customerId), expectLinkToken: next.token },
        q.id,
        input,
      );
      expect(done.customerFlag).toBeNull();
      expect((await findQuote(tx, q.id)).status).toBe("ACCEPTED");
    });
  });
});
