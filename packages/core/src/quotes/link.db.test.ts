import { describe, expect, it } from "vitest";
import { DomainError, ForbiddenError } from "../customers/access";
import { formatCustomerNumber } from "../customers/number";
import { anonymiseCustomer } from "../customers/privacy";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { createQuote } from "./drafts";
import { issueQuote, reviseQuote, withdrawQuote } from "./issue";
import { createQuoteLink, revokeQuoteLink } from "./link";
import { findQuote } from "./store";
import { isLinkTokenShape } from "./token";
import { crew, makeCustomer, makeIssued, manager, owner } from "./test-helpers";

describe.skipIf(!dbTestsEnabled)("the private client link", () => {
  it("is created automatically when a quote is issued", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      const row = await findQuote(tx, q.id);
      expect(isLinkTokenShape(row.linkToken ?? "")).toBe(true);
      expect(row.linkCreatedAt).toBeInstanceOf(Date);
      expect(row.firstViewedAt).toBeNull();
    });
  });

  it("returns the existing code, replaces it on request, and resets the view times", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      const before = (await findQuote(tx, q.id)).linkToken;
      expect((await createQuoteLink(tx, manager, q.id)).token).toBe(before);

      await tx.quote.update({
        where: { id: q.id },
        data: { firstViewedAt: new Date(), lastViewedAt: new Date() },
      });
      const next = await createQuoteLink(tx, manager, q.id, { replace: true });
      expect(next.token).not.toBe(before);
      expect(isLinkTokenShape(next.token)).toBe(true);
      const row = await findQuote(tx, q.id);
      expect(row.linkToken).toBe(next.token);
      expect(row.firstViewedAt).toBeNull();
      expect(row.lastViewedAt).toBeNull();
      expect(await tx.quote.count({ where: { linkToken: before } })).toBe(0);
    });
  });

  it("can be revoked and made again; revoking twice does nothing", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      await revokeQuoteLink(tx, manager, q.id);
      expect((await findQuote(tx, q.id)).linkToken).toBeNull();
      await revokeQuoteLink(tx, manager, q.id);
      expect(
        await tx.auditLog.count({ where: { entityId: q.id, action: "quote.link_revoked" } }),
      ).toBe(1);
      const again = await createQuoteLink(tx, manager, q.id);
      expect(isLinkTokenShape(again.token)).toBe(true);
      expect((await findQuote(tx, q.id)).linkToken).toBe(again.token);
    });
  });

  it("never writes the code into the audit log", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      const { token } = await createQuoteLink(tx, manager, q.id, { replace: true });
      await revokeQuoteLink(tx, manager, q.id);
      const audit = await tx.auditLog.findMany({ where: { entityId: q.id } });
      expect(audit.map((a) => a.action)).toEqual(
        expect.arrayContaining(["quote.link_created", "quote.link_revoked"]),
      );
      expect(JSON.stringify(audit)).not.toContain(token);
    });
  });

  it("is refused for a draft and for a withdrawn quote", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id: draft } = await createQuote(tx, manager, c);
      await expect(createQuoteLink(tx, manager, draft)).rejects.toThrow(
        "A link can only be made for an issued, accepted or declined quote.",
      );
      const withdrawn = await makeIssued(tx);
      await withdrawQuote(tx, manager, withdrawn.id);
      await expect(createQuoteLink(tx, manager, withdrawn.id)).rejects.toBeInstanceOf(DomainError);
    });
  });

  it("is refused for a replaced quote", async () => {
    await withRollback(async (tx) => {
      const original = await makeIssued(tx);
      const { id: revision } = await reviseQuote(tx, manager, original.id);
      await issueQuote(tx, manager, revision);
      expect((await findQuote(tx, original.id)).status).toBe("REPLACED");
      await expect(createQuoteLink(tx, manager, original.id)).rejects.toBeInstanceOf(DomainError);
    });
  });

  it("is refused for an anonymised customer's quote, and anonymising wipes the code", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      expect((await findQuote(tx, q.id)).linkToken).not.toBeNull();
      const number = (await tx.customer.findUniqueOrThrow({ where: { id: q.customerId } })).number;
      await anonymiseCustomer(tx, owner, q.customerId, formatCustomerNumber(number));
      expect((await findQuote(tx, q.id)).linkToken).toBeNull();
      await expect(createQuoteLink(tx, manager, q.id)).rejects.toThrow(
        "This customer has been anonymised and cannot be changed.",
      );
    });
  });

  it("refuses crew", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      await expect(createQuoteLink(tx, crew, q.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(revokeQuoteLink(tx, crew, q.id)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
