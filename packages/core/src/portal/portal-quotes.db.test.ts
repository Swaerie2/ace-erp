import { describe, expect, it } from "vitest";
import { createQuote } from "../quotes/drafts";
import { withdrawQuote } from "../quotes/issue";
import { revokeQuoteLink } from "../quotes/link";
import { reverseAcceptance } from "../quotes/outcomes";
import { addDays, todaySA } from "../quotes/reference";
import { findQuote } from "../quotes/store";
import { manager, monthlyLine, optionalLine, owner, token } from "../quotes/test-helpers";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { getPortalHome } from "./home";
import { acceptPortalQuote, declinePortalQuote, getPortalQuote } from "./quotes";
import { asPortal, issueFor, makeClient, scopeOf } from "./test-helpers";

const ctx = { ip: "203.0.113.44", userAgent: "ZZ Test Browser" };
const accept = (acceptedBy: string, chosenLineIds: string[] = []) => ({
  acceptedBy,
  startDate: addDays(todaySA(), 4),
  chosenLineIds,
});

// Each issued quote costs about 10 seconds; no test below issues more than two.

describe.skipIf(!dbTestsEnabled)("portal quotes, run as ace_portal", () => {
  it("lets an agency see and accept its complexes' quotes, and keeps a trustee to their own complex", async () => {
    await withRollback(async (tx) => {
      const agency = await makeClient(tx, { name: `ZZ E2E Agency ${token()}` });
      const x = await makeClient(tx, {
        managedById: agency.customerId,
        name: `ZZ E2E Complex ${token()}`,
      });
      const y = await makeClient(tx, {
        managedById: agency.customerId,
        name: `ZZ E2E Complex ${token()}`,
      });
      const qx = await issueFor(tx, x);
      const qy = await issueFor(tx, y, { lines: [monthlyLine(), optionalLine()] });
      const optionId = (await findQuote(tx, qy)).lines[1]!.id;

      await asPortal(tx, async () => {
        const agencyScope = await scopeOf(tx, agency.email);
        const trusteeScope = await scopeOf(tx, x.email);

        const agencyHome = await getPortalHome(tx, agencyScope);
        expect(agencyHome.hasManaged).toBe(true);
        expect(agencyHome.groups.map((g) => g.id).sort()).toEqual(
          [agency.customerId, x.customerId, y.customerId].sort(),
        );
        const trusteeHome = await getPortalHome(tx, trusteeScope);
        expect(trusteeHome.hasManaged).toBe(false);
        expect(trusteeHome.groups.map((g) => g.id)).toEqual([x.customerId]);
        expect(trusteeHome.groups[0]?.properties[0]?.quotes.map((q) => q.id)).toEqual([qx]);
        const searched = await getPortalHome(tx, agencyScope, { q: y.name.slice(-10) });
        expect(searched.groups.map((g) => g.id)).toEqual([y.customerId]);

        // A trustee of complex X cannot reach complex Y's quote by its id.
        expect(await getPortalQuote(tx, trusteeScope, qy)).toBeNull();
        expect(await acceptPortalQuote(tx, trusteeScope, qy, accept("ZZ Trustee"), ctx)).toEqual({
          outcome: "NOT_FOUND",
        });
        expect(await declinePortalQuote(tx, trusteeScope, qy, {})).toEqual({
          outcome: "NOT_FOUND",
        });

        const view = await getPortalQuote(tx, agencyScope, qy);
        expect(view?.state).toBe("OPEN");
        expect(view?.id).toBe(qy);
        expect(JSON.stringify(view)).not.toContain("@example.com");
        expect(
          await acceptPortalQuote(
            tx,
            agencyScope,
            qy,
            accept("ZZ E2E Agency Person", [optionId]),
            ctx,
          ),
        ).toEqual({ outcome: "ACCEPTED", customerFlag: null, quoteId: qy });
        // A double click is recorded once.
        expect(
          await acceptPortalQuote(tx, agencyScope, qy, accept("ZZ E2E Agency Person"), ctx),
        ).toEqual({
          outcome: "ALREADY_ACCEPTED",
        });
      });

      const after = await findQuote(tx, qy);
      expect(after).toMatchObject({
        status: "ACCEPTED",
        acceptedMethod: "CLIENT_PORTAL",
        acceptedByContactId: agency.contactId,
        acceptedByName: "ZZ E2E Agency Person",
        acceptedByStaffId: null,
        acceptedIp: ctx.ip,
        acceptedUserAgent: ctx.userAgent,
      });
      expect(after.lines.map((l) => l.chosen)).toEqual([false, true]);
      expect((await findQuote(tx, qx)).status).toBe("ISSUED");

      const audit = await tx.auditLog.findMany({
        where: { entityId: qy, action: "quote.accepted" },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actorType: "CUSTOMER",
        actorId: agency.customerId,
        ip: null,
        userAgent: null,
      });
      expect(audit[0]?.after).toMatchObject({ method: "CLIENT_PORTAL", optionsChosen: 1 });
      const text = JSON.stringify(audit);
      for (const typed of ["ZZ E2E Agency Person", ctx.ip, ctx.userAgent, agency.email]) {
        expect(text).not.toContain(typed);
      }

      // A staff reversal also clears who accepted in the portal.
      await reverseAcceptance(tx, owner, qy, "ZZ test reversal");
      expect((await findQuote(tx, qy)).acceptedByContactId).toBeNull();
    });
  });

  it("refuses a request whose scope went stale: a complex moved agency, or the person's access was removed", async () => {
    await withRollback(async (tx) => {
      const first = await makeClient(tx);
      const second = await makeClient(tx);
      const complex = await makeClient(tx, { managedById: first.customerId });
      const q = await issueFor(tx, complex);
      const staleAgency = await scopeOf(tx, first.email);
      const staleTrustee = await scopeOf(tx, complex.email);
      expect(staleAgency.customerIds).toContain(complex.customerId);

      await tx.customer.update({
        where: { id: complex.customerId },
        data: { managedById: second.customerId },
      });
      await tx.contact.update({ where: { id: complex.contactId }, data: { portalAccess: false } });

      await asPortal(tx, async () => {
        expect((await scopeOf(tx, first.email)).customerIds).not.toContain(complex.customerId);
        expect((await scopeOf(tx, second.email)).customerIds).toContain(complex.customerId);
        expect(await acceptPortalQuote(tx, staleAgency, q, accept("ZZ Old Agency"), ctx)).toEqual({
          outcome: "NOT_FOUND",
        });
        // The trustee's old scope still finds the quote; the fresh check under the customer lock refuses it.
        expect(await acceptPortalQuote(tx, staleTrustee, q, accept("ZZ Trustee"), ctx)).toEqual({
          outcome: "NOT_FOUND",
        });
        expect(await declinePortalQuote(tx, staleTrustee, q, {})).toEqual({ outcome: "NOT_FOUND" });
      });
      expect((await findQuote(tx, q)).status).toBe("ISSUED");
    });
  });

  it("shows only issued, accepted and declined quotes, declines in the portal, and ignores a revoked link", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const open = await issueFor(tx, client);
      const withdrawn = await issueFor(tx, client);
      await withdrawQuote(tx, manager, withdrawn);
      const { id: draft } = await createQuote(tx, manager, {
        customerId: client.customerId,
        propertyId: client.propertyId,
      });
      await revokeQuoteLink(tx, manager, open);

      await asPortal(tx, async () => {
        const scope = await scopeOf(tx, client.email);
        const home = await getPortalHome(tx, scope);
        const ids = home.groups
          .flatMap((g) => [...g.properties.flatMap((p) => p.quotes), ...g.otherQuotes])
          .map((q) => q.id);
        expect(ids).toEqual([open]);
        expect(await getPortalQuote(tx, scope, withdrawn)).toBeNull();
        expect(await getPortalQuote(tx, scope, draft)).toBeNull();
        expect(await getPortalQuote(tx, scope, "not-a-uuid")).toBeNull();
        expect((await getPortalQuote(tx, scope, open))?.state).toBe("OPEN");
        expect(await acceptPortalQuote(tx, scope, withdrawn, accept("ZZ Client"), ctx)).toEqual({
          outcome: "NOT_FOUND",
        });
        expect(await declinePortalQuote(tx, scope, open, { reason: "ZZ too dear" })).toEqual({
          outcome: "DECLINED",
        });
        expect(await declinePortalQuote(tx, scope, open, {})).toEqual({
          outcome: "ALREADY_DECLINED",
        });
        expect(await acceptPortalQuote(tx, scope, open, accept("ZZ Client"), ctx)).toEqual({
          outcome: "NOT_AVAILABLE",
        });
        expect((await getPortalQuote(tx, scope, open))?.state).toBe("DECLINED");
      });

      expect(await findQuote(tx, open)).toMatchObject({
        status: "DECLINED",
        declinedByClient: true,
        declineReason: "ZZ too dear",
        linkToken: null,
      });
      const audit = await tx.auditLog.findMany({
        where: { entityId: open, action: "quote.declined" },
      });
      expect(audit[0]).toMatchObject({ actorType: "CUSTOMER", actorId: client.customerId });
      expect(audit[0]?.after).toEqual({ via: "portal" });
      expect(JSON.stringify(audit)).not.toContain("ZZ too dear");
    });
  });
});
