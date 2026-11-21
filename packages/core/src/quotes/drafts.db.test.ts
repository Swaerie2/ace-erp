import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DomainError, ForbiddenError } from "../customers/access";
import { archiveCustomer } from "../customers/customers";
import { archiveProperty } from "../customers/properties";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { createQuote, deleteDraft, getQuote, listQuotes, saveDraft } from "./drafts";
import { addDays, toDateString, todaySA } from "./reference";
import { DraftConflictError, findQuote } from "./store";
import {
  crew,
  fillDraft,
  makeCustomer,
  manager,
  monthlyLine,
  onceOffLine,
  optionalLine,
  owner,
  token,
} from "./test-helpers";
import { readQuoteWording } from "./wording";

describe.skipIf(!dbTestsEnabled)("quote drafts", () => {
  it("starts a draft with every active service as Not included, and audits it without personal text", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const wording = await readQuoteWording(tx);
      const { id } = await createQuote(tx, manager, c);

      const quote = await findQuote(tx, id);
      expect(quote.status).toBe("DRAFT");
      expect(quote.numberYear).toBeNull();
      expect(quote.draftVersion).toBe(1);
      expect(toDateString(quote.validUntil)).toBe(addDays(todaySA(), wording.defaultValidityDays));
      const services = await tx.service.findMany({ where: { archivedAt: null } });
      expect(quote.scopeItems).toHaveLength(services.length);
      expect(quote.scopeItems.every((s) => !s.included && s.name && s.description)).toBe(true);

      const audit = await tx.auditLog.findMany({ where: { entityId: id } });
      expect(audit.map((a) => a.action)).toEqual(["quote.created"]);
      expect(JSON.stringify(audit)).not.toContain(c.contactName);
    });
  });

  it("refuses an archived customer, someone else's property, an archived property, and crew", async () => {
    await withRollback(async (tx) => {
      const a = await makeCustomer(tx);
      const b = await makeCustomer(tx);
      await expect(
        createQuote(tx, manager, { customerId: a.customerId, propertyId: b.propertyId }),
      ).rejects.toThrow("Choose one of this customer's properties.");
      await expect(createQuote(tx, crew, a)).rejects.toBeInstanceOf(ForbiddenError);

      await archiveProperty(tx, manager, a.propertyId);
      await expect(createQuote(tx, manager, a)).rejects.toBeInstanceOf(DomainError);
      await archiveCustomer(tx, manager, b.customerId);
      await expect(createQuote(tx, manager, b)).rejects.toThrow(
        "Restore this customer before quoting.",
      );
    });
  });

  it("saves scope, lines, date and note, and raises the version", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      const { version } = await fillDraft(tx, id, {
        internalNote: `  note ${token()} `,
        lines: [monthlyLine(), onceOffLine(), optionalLine()],
      });
      expect(version).toBe(2);

      const quote = await findQuote(tx, id);
      expect(quote.scopeItems.filter((s) => s.included)).toHaveLength(1);
      expect(quote.lines.map((l) => l.lineKind)).toEqual(["PRICED", "PRICED", "OPTIONAL"]);
      expect(quote.lines.map((l) => l.sortOrder)).toEqual([1, 2, 3]);
      expect(quote.internalNote?.startsWith("note ")).toBe(true);
      expect(quote.draftVersion).toBe(2);
    });
  });

  it("makes an included line free and drops the frequency of a once-off line", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      await fillDraft(tx, id, {
        lines: [
          monthlyLine(),
          {
            lineKind: "INCLUDED",
            billing: "MONTHLY",
            frequency: "WEEKLY",
            description: "Green waste removal",
            amountCents: 500,
          },
          onceOffLine({ frequency: "WEEKLY" }),
        ],
      });
      const lines = (await findQuote(tx, id)).lines;
      expect(lines[1]).toMatchObject({ billing: null, frequency: null, amountCents: null });
      expect(lines[2]?.frequency).toBeNull();
    });
  });

  it("writes nothing when a save changes nothing", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      await fillDraft(tx, id);
      const before = await findQuote(tx, id);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const same = await saveDraft(tx, manager, id, {
        version: before.draftVersion,
        validUntil: toDateString(before.validUntil),
        internalNote: before.internalNote ?? "",
        scope: before.scopeItems.map((s) => ({ serviceId: s.serviceId, included: s.included })),
        lines: before.lines.map((l) => ({
          lineKind: l.lineKind,
          billing: l.billing,
          frequency: l.frequency,
          description: l.description,
          amountCents: l.amountCents,
        })),
      });
      expect(same.version).toBe(before.draftVersion);
      const after = await findQuote(tx, id);
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      expect(after.lines.map((l) => l.id)).toEqual(before.lines.map((l) => l.id));
    });
  });

  it("refuses a save made from an old version, so nothing is overwritten", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      const old = await findQuote(tx, id);
      await fillDraft(tx, id); // version 1 -> 2
      await expect(
        saveDraft(tx, manager, id, {
          version: old.draftVersion,
          validUntil: toDateString(old.validUntil),
          internalNote: "other device",
          scope: [],
          lines: [],
        }),
      ).rejects.toBeInstanceOf(DraftConflictError);
      expect((await findQuote(tx, id)).lines).toHaveLength(1);
    });
  });

  it("refuses a service that is not on the quote", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      const q = await findQuote(tx, id);
      await expect(
        saveDraft(tx, manager, id, {
          version: q.draftVersion,
          validUntil: toDateString(q.validUntil),
          internalNote: "",
          scope: [{ serviceId: randomUUID(), included: true }],
          lines: [],
        }),
      ).rejects.toThrow("That service is not on this quote.");
    });
  });

  it("deletes a never-issued draft with its rows, and audits it", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      await fillDraft(tx, id);
      await deleteDraft(tx, manager, id);
      expect(await tx.quote.count({ where: { id } })).toBe(0);
      expect(await tx.quoteLine.count({ where: { quoteId: id } })).toBe(0);
      expect(await tx.quoteScopeItem.count({ where: { quoteId: id } })).toBe(0);
      const audit = await tx.auditLog.findMany({ where: { entityId: id }, orderBy: { at: "asc" } });
      expect(audit.map((a) => a.action)).toEqual(["quote.created", "quote.deleted_draft"]);
    });
  });

  it("reads a quote with its customer and property, and lists and filters drafts", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      const full = await getQuote(tx, manager, id);
      expect(full?.customer.displayName).toContain("Quote Test");
      expect(full?.property.label).toBe("Main");
      expect(await getQuote(tx, manager, randomUUID())).toBeNull();

      const byCustomer = await listQuotes(tx, manager, { customerId: c.customerId });
      expect(byCustomer.items.map((i) => i.id)).toEqual([id]);
      expect(byCustomer.items[0]).toMatchObject({ reference: null, displayStatus: "DRAFT" });

      const name = full?.customer.displayName ?? "";
      const found = await listQuotes(tx, manager, { q: name, status: "DRAFT" });
      expect(found.items.some((i) => i.id === id)).toBe(true);
      const none = await listQuotes(tx, manager, { q: name, status: "ACCEPTED" });
      expect(none.items).toHaveLength(0);
    });
  });

  it("refuses crew every function", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, owner, c);
      await expect(getQuote(tx, crew, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listQuotes(tx, crew, {})).rejects.toBeInstanceOf(ForbiddenError);
      await expect(deleteDraft(tx, crew, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        saveDraft(tx, crew, id, {
          version: 1,
          validUntil: todaySA(),
          internalNote: "",
          scope: [],
          lines: [],
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
