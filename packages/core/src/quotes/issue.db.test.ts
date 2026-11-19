import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DomainError, ForbiddenError } from "../customers/access";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { createQuote, listQuotes, saveDraft } from "./drafts";
import {
  allocateQuoteNumber,
  issueQuote,
  markSent,
  QuoteIssueError,
  reviseQuote,
  withdrawQuote,
} from "./issue";
import { addDays, fromDateString, todaySA } from "./reference";
import { findQuote } from "./store";
import {
  crew,
  fillDraft,
  makeCustomer,
  makeIssued,
  manager,
  monthlyLine,
  onceOffLine,
  optionalLine,
  token,
} from "./test-helpers";
import { wordingSnapshotSchema } from "./wording-schema";

describe.skipIf(!dbTestsEnabled)("issuing quotes", () => {
  it("gives the quote a number, freezes the details and the wording, and fingerprints it", async () => {
    await withRollback(async (tx) => {
      const issued = await makeIssued(tx);
      expect(issued.reference).toMatch(/^QUO-\d{4}-\d{4,}$/);
      const q = await findQuote(tx, issued.id);
      expect(q.status).toBe("ISSUED");
      expect(q.numberYear).toBe(Number(todaySA().slice(0, 4)));
      expect(q.recipientName).toBe(issued.contactName);
      expect(q.siteLabel).toBe("Main");
      expect(q.siteAddress).toContain("1 Quote Street");
      expect(q.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(q.issuedAt).toBeInstanceOf(Date);
      const snapshot = wordingSnapshotSchema.parse(q.wordingSnapshot);
      expect(snapshot.termSections.map((s) => s.title)).toEqual(["Monthly contract", "General"]);
    });
  });

  it("explains in plain words why an incomplete draft cannot be issued", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      const error = await issueQuote(tx, manager, id).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(QuoteIssueError);
      expect((error as QuoteIssueError).problems).toEqual([
        "Switch on at least one service.",
        "Add at least one monthly or once-off price.",
      ]);
      expect((await findQuote(tx, id)).status).toBe("DRAFT");
    });
  });

  it("shows both term sets for a quote with monthly and once-off work", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      await fillDraft(tx, id, { lines: [monthlyLine(), onceOffLine(), optionalLine()] });
      await issueQuote(tx, manager, id);
      const snapshot = wordingSnapshotSchema.parse((await findQuote(tx, id)).wordingSnapshot);
      expect(snapshot.termSections.map((s) => s.title)).toEqual([
        "Monthly contract",
        "Once-off work",
        "General",
      ]);
    });
  });

  it("refreshes the scope from the catalogue when issuing", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      await fillDraft(tx, id);
      const name = `Added later ${token()}`;
      const max = await tx.service.aggregate({ _max: { sortOrder: true } });
      const added = await tx.service.create({
        data: { name, description: "New", sortOrder: (max._max.sortOrder ?? 0) + 1 },
      });
      await issueQuote(tx, manager, id);
      const scope = (await findQuote(tx, id)).scopeItems;
      expect(scope.find((s) => s.serviceId === added.id)).toMatchObject({ name, included: false });
    });
  });

  it("allocates running numbers per year without gaps or repeats", async () => {
    await withRollback(async (tx) => {
      expect(await allocateQuoteNumber(tx, 2098)).toBe(1);
      expect(await allocateQuoteNumber(tx, 2098)).toBe(2);
      expect(await allocateQuoteNumber(tx, 2099)).toBe(1);
      expect(await allocateQuoteNumber(tx, 2098)).toBe(3);
    });
  });

  it("gives two quotes issued one after the other different numbers", async () => {
    await withRollback(async (tx) => {
      const a = await makeIssued(tx);
      const b = await makeIssued(tx);
      expect(a.reference).not.toBe(b.reference);
    });
  });

  it("cannot be saved or issued again once issued, and the audit has no personal text", async () => {
    await withRollback(async (tx) => {
      const issued = await makeIssued(tx);
      const q = await findQuote(tx, issued.id);
      await expect(
        saveDraft(tx, manager, issued.id, {
          version: q.draftVersion,
          validUntil: addDays(todaySA(), 5),
          internalNote: "",
          scope: [],
          lines: [],
        }),
      ).rejects.toThrow("Only a draft can be changed.");
      await expect(issueQuote(tx, manager, issued.id)).rejects.toThrow(
        "Only a draft can be issued.",
      );
      const audit = await tx.auditLog.findMany({
        where: { entityId: issued.id },
        orderBy: { at: "asc" },
      });
      expect(audit.map((a) => a.action)).toEqual(["quote.created", "quote.issued"]);
      expect(JSON.stringify(audit)).not.toContain(issued.contactName);
    });
  });
});

describe.skipIf(!dbTestsEnabled)("revising, withdrawing and sending", () => {
  it("revises into a new draft, keeps the number on issue and replaces the old quote", async () => {
    await withRollback(async (tx) => {
      const original = await makeIssued(tx);
      const { id: draftId } = await reviseQuote(tx, manager, original.id);
      const draft = await findQuote(tx, draftId);
      expect(draft).toMatchObject({ status: "DRAFT", revision: 2, revisionOfId: original.id });
      expect(draft.lines).toHaveLength(1);
      expect(draft.scopeItems.filter((s) => s.included)).toHaveLength(1);

      await expect(reviseQuote(tx, manager, original.id)).rejects.toThrow(
        "There is already a draft revision of this quote.",
      );

      const reissued = await issueQuote(tx, manager, draftId);
      expect(reissued.reference).toBe(`${original.reference} R2`);
      expect((await findQuote(tx, original.id)).status).toBe("REPLACED");
      expect((await findQuote(tx, draftId)).status).toBe("ISSUED");
      await expect(reviseQuote(tx, manager, original.id)).rejects.toThrow(
        "This quote cannot be revised.",
      );
    });
  });

  it("cannot revise a draft", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      await expect(reviseQuote(tx, manager, id)).rejects.toThrow("This quote cannot be revised.");
    });
  });

  it("withdraws an issued quote and nothing else", async () => {
    await withRollback(async (tx) => {
      const issued = await makeIssued(tx);
      await withdrawQuote(tx, manager, issued.id);
      expect((await findQuote(tx, issued.id)).status).toBe("WITHDRAWN");
      await expect(withdrawQuote(tx, manager, issued.id)).rejects.toBeInstanceOf(DomainError);
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      await expect(withdrawQuote(tx, manager, id)).rejects.toBeInstanceOf(DomainError);
    });
  });

  it("records how and when an issued quote was sent", async () => {
    await withRollback(async (tx) => {
      const issued = await makeIssued(tx);
      await markSent(tx, manager, issued.id, "WHATSAPP");
      const q = await findQuote(tx, issued.id);
      expect(q.sentMethod).toBe("WHATSAPP");
      expect(q.sentAt).toBeInstanceOf(Date);
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      await expect(markSent(tx, manager, id, "EMAIL")).rejects.toBeInstanceOf(DomainError);
    });
  });

  it("lists issued and expired quotes under the right filters", async () => {
    await withRollback(async (tx) => {
      const live = await makeIssued(tx);
      const old = await makeIssued(tx);
      await tx.quote.update({
        where: { id: old.id },
        data: { validUntil: fromDateString(addDays(todaySA(), -1)) },
      });
      const issuedList = await listQuotes(tx, manager, {
        status: "ISSUED",
        customerId: live.customerId,
      });
      expect(issuedList.items.map((i) => i.id)).toEqual([live.id]);
      expect(issuedList.items[0]?.totals.monthly).toBe(115000);
      const expired = await listQuotes(tx, manager, {
        status: "EXPIRED",
        customerId: old.customerId,
      });
      expect(expired.items.map((i) => i.id)).toEqual([old.id]);
      expect(expired.items[0]?.displayStatus).toBe("EXPIRED");
      const byRef = await listQuotes(tx, manager, { q: live.reference });
      expect(byRef.items.some((i) => i.id === live.id)).toBe(true);
    });
  });

  it("refuses crew every function, and says a missing quote could not be found", async () => {
    await withRollback(async (tx) => {
      const issued = await makeIssued(tx);
      await expect(issueQuote(tx, crew, issued.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(reviseQuote(tx, crew, issued.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(withdrawQuote(tx, crew, issued.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(markSent(tx, crew, issued.id, "EMAIL")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(issueQuote(tx, manager, randomUUID())).rejects.toThrow(
        "That quote could not be found.",
      );
    });
  });
});
