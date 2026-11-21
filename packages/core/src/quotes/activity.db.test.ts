import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../customers/access";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { listQuoteActivity } from "./activity";
import { crew, makeIssued, manager } from "./test-helpers";

describe.skipIf(!dbTestsEnabled)("quote activity", () => {
  it("lists a quote's history newest first, without personal text", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      const entries = await listQuoteActivity(tx, manager, q.id);
      expect(entries.map((e) => e.action)).toEqual(["quote.issued", "quote.created"]);
      expect(entries[0]?.actorName).toBe("Staff");
      expect(JSON.stringify(entries)).not.toContain(q.contactName);
    });
  });

  it("refuses crew", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      await expect(listQuoteActivity(tx, crew, q.id)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
