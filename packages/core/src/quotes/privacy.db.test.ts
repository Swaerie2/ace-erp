import { describe, expect, it } from "vitest";
import { formatCustomerNumber } from "../customers/number";
import { anonymiseCustomer, exportCustomerData } from "../customers/privacy";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { acceptQuote, declineQuote } from "./outcomes";
import { addDays, todaySA } from "./reference";
import { acceptSchema } from "./schemas";
import { findQuote } from "./store";
import { makeIssued, manager, owner } from "./test-helpers";

async function numberOf(tx: Parameters<Parameters<typeof withRollback>[0]>[0], customerId: string) {
  const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
  return formatCustomerNumber(c.number);
}

describe.skipIf(!dbTestsEnabled)("quotes and the privacy tools", () => {
  it("includes a customer's quotes in the owner's data export", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      const exported = await exportCustomerData(tx, owner, q.customerId);
      expect(exported.customer.quotes.map((x) => x.id)).toEqual([q.id]);
      expect(exported.customer.quotes[0]?.lines).toHaveLength(1);
      // The live client link code is a credential, not something held about the customer.
      const code = (await findQuote(tx, q.id)).linkToken ?? "";
      expect(code).not.toBe("");
      expect(exported.customer.quotes[0]).not.toHaveProperty("linkToken");
      expect(JSON.stringify(exported)).not.toContain(code);
    });
  });

  it("wipes every personal column on the customer's quotes and keeps the money and the fingerprint", async () => {
    await withRollback(async (tx) => {
      const accepted = await makeIssued(tx, {
        status: "ACTIVE",
        draft: { internalNote: "Gate code 9999" },
      });
      await acceptQuote(
        tx,
        manager,
        accepted.id,
        acceptSchema.parse({
          method: "PHONE",
          acceptedBy: "A. Client",
          startDate: addDays(todaySA(), 3),
          chosenLineIds: [],
          note: "Phoned me",
        }),
      );
      await tx.quote.update({
        where: { id: accepted.id },
        data: {
          acceptedIp: "203.0.113.7",
          acceptedUserAgent: "Test Browser",
          declineReason: "n/a",
          reversalNote: "n/a",
        },
      });
      const before = await findQuote(tx, accepted.id);
      expect(before.recipientName).toBeTruthy();
      expect(before.internalNote).toBe("Gate code 9999");
      expect(before.linkToken).not.toBeNull();

      await anonymiseCustomer(
        tx,
        owner,
        accepted.customerId,
        await numberOf(tx, accepted.customerId),
      );

      const after = await findQuote(tx, accepted.id);
      for (const column of [
        "internalNote",
        "recipientName",
        "recipientEmail",
        "recipientPhone",
        "siteLabel",
        "siteAddress",
        "acceptedByName",
        "acceptanceNote",
        "acceptedIp",
        "acceptedUserAgent",
        "declineReason",
        "reversalNote",
        "linkToken",
      ] as const) {
        expect(after[column], column).toBeNull();
      }
      expect(after.contentHash).toBe(before.contentHash);
      expect(after.lines.map((l) => l.amountCents)).toEqual(before.lines.map((l) => l.amountCents));
      expect(after.status).toBe("ACCEPTED");
    });
  });

  it("also scrubs a declined quote's reason", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      await declineQuote(tx, manager, q.id, { reason: "Moving house to 5 Example Road" });
      await anonymiseCustomer(tx, owner, q.customerId, await numberOf(tx, q.customerId));
      expect((await findQuote(tx, q.id)).declineReason).toBeNull();
    });
  });
});
