import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../customers/access";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { listQuoteActivity } from "./activity";
import { acceptViaLink } from "./public";
import { addDays, todaySA } from "./reference";
import { findQuote } from "./store";
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

  it("names a client acceptance on the link as the client, not as staff", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      const link = (await findQuote(tx, q.id)).linkToken ?? "";
      await acceptViaLink(
        tx,
        link,
        { acceptedBy: "A. Client", startDate: addDays(todaySA(), 3), chosenLineIds: [] },
        { ip: null, userAgent: "Test Browser" },
      );
      const entries = await listQuoteActivity(tx, manager, q.id);
      const accepted = entries.find((e) => e.action === "quote.accepted");
      expect(accepted).toMatchObject({ actorType: "CUSTOMER", actorName: "Client (private link)" });
      const issued = entries.find((e) => e.action === "quote.issued");
      expect(issued).toMatchObject({ actorType: "STAFF" });
    });
  });

  it("refuses crew", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      await expect(listQuoteActivity(tx, crew, q.id)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
