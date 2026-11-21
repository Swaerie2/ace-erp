import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../customers/access";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { crew, manager, owner, token } from "./test-helpers";
import { getQuoteWording, updateQuoteWording } from "./wording";
import { wordingSchema } from "./wording-schema";

describe.skipIf(!dbTestsEnabled)("quote wording", () => {
  it("has the standard wording in place and readable as a manager", async () => {
    await withRollback(async (tx) => {
      const { updatedAt, ...wording } = await getQuoteWording(tx, manager);
      expect(updatedAt).toBeInstanceOf(Date);
      expect(wordingSchema.safeParse(wording).success).toBe(true);
      expect(wording.monthlyTerms.length).toBeGreaterThan(0);
      expect(wording.defaultValidityDays).toBeGreaterThanOrEqual(1);
    });
  });

  it("lets only the owner change it, and audits field names only", async () => {
    await withRollback(async (tx) => {
      const { updatedAt, ...current } = await getQuoteWording(tx, owner);
      void updatedAt;
      const tagline = `Tagline ${token()}`;
      await expect(updateQuoteWording(tx, manager, { ...current, tagline })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await updateQuoteWording(tx, owner, { ...current, tagline, defaultValidityDays: 14 });
      const after = await getQuoteWording(tx, owner);
      expect(after.tagline).toBe(tagline);
      expect(after.defaultValidityDays).toBe(14);

      const audit = await tx.auditLog.findMany({
        where: { entityType: "quote_wording", action: "quote_wording.updated" },
        orderBy: { at: "desc" },
        take: 1,
      });
      expect(audit[0]?.after).toEqual({ changed: ["tagline", "defaultValidityDays"] });
      expect(JSON.stringify(audit)).not.toContain(tagline);
    });
  });

  it("writes nothing when nothing changed", async () => {
    await withRollback(async (tx) => {
      const { updatedAt: before, ...current } = await getQuoteWording(tx, owner);
      const auditBefore = await tx.auditLog.count({ where: { action: "quote_wording.updated" } });
      await new Promise((resolve) => setTimeout(resolve, 20));
      await updateQuoteWording(tx, owner, current);
      const { updatedAt: after } = await getQuoteWording(tx, owner);
      expect(after.getTime()).toBe(before.getTime());
      expect(await tx.auditLog.count({ where: { action: "quote_wording.updated" } })).toBe(
        auditBefore,
      );
    });
  });

  it("refuses crew", async () => {
    await withRollback(async (tx) => {
      await expect(getQuoteWording(tx, crew)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
