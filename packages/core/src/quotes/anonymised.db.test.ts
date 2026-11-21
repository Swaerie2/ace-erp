import { describe, expect, it } from "vitest";
import { archiveCustomer } from "../customers/customers";
import { formatCustomerNumber } from "../customers/number";
import { archiveProperty } from "../customers/properties";
import { anonymiseCustomer } from "../customers/privacy";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { createQuote, deleteDraft, saveDraft } from "./drafts";
import { issueQuote, reviseQuote } from "./issue";
import { toDateString } from "./reference";
import { findQuote } from "./store";
import { fillDraft, makeCustomer, makeIssued, manager, monthlyLine, owner } from "./test-helpers";

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];

async function anonymise(tx: Tx, customerId: string) {
  const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
  await anonymiseCustomer(tx, owner, customerId, formatCustomerNumber(c.number));
}

const ANONYMISED_CHANGE = "This customer has been anonymised and cannot be changed.";

describe.skipIf(!dbTestsEnabled)("quotes of an anonymised customer", () => {
  it("refuses a draft save after the customer was anonymised, and stores nothing", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      const quote = await findQuote(tx, id);
      await anonymise(tx, c.customerId);

      await expect(
        saveDraft(tx, manager, id, {
          version: quote.draftVersion,
          validUntil: toDateString(quote.validUntil),
          internalNote: "Gate code 9999",
          scope: quote.scopeItems.map((s) => ({ serviceId: s.serviceId, included: false })),
          lines: [],
        }),
      ).rejects.toThrow(ANONYMISED_CHANGE);
      const after = await findQuote(tx, id);
      expect(after.internalNote).toBeNull();
      expect(after.draftVersion).toBe(quote.draftVersion);
    });
  });

  it("refuses to revise an issued quote of an anonymised customer, and makes no draft", async () => {
    await withRollback(async (tx) => {
      const issued = await makeIssued(tx);
      await anonymise(tx, issued.customerId);
      await expect(reviseQuote(tx, manager, issued.id)).rejects.toThrow(ANONYMISED_CHANGE);
      const drafts = await tx.quote.count({
        where: { customerId: issued.customerId, status: "DRAFT" },
      });
      expect(drafts).toBe(0);
    });
  });

  it("refuses to start a quote for an anonymised customer", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      await anonymise(tx, c.customerId);
      await expect(createQuote(tx, manager, c)).rejects.toThrow(
        "This customer has been anonymised and cannot be quoted.",
      );
    });
  });

  it("still lets a never-issued draft of an anonymised customer be deleted", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      await anonymise(tx, c.customerId);
      await deleteDraft(tx, manager, id);
      expect(await tx.quote.count({ where: { id } })).toBe(0);
    });
  });
});

describe.skipIf(!dbTestsEnabled)("issuing after the customer or property changed", () => {
  it("refuses to issue when the customer was archived after the draft was made", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      await fillDraft(tx, id, { lines: [monthlyLine()] });
      await archiveCustomer(tx, manager, c.customerId);
      await expect(issueQuote(tx, manager, id)).rejects.toThrow(
        "Restore this customer before quoting.",
      );
      expect((await findQuote(tx, id)).status).toBe("DRAFT");
    });
  });

  it("refuses to issue when the property was archived after the draft was made", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      await fillDraft(tx, id, { lines: [monthlyLine()] });
      await archiveProperty(tx, manager, c.propertyId);
      await expect(issueQuote(tx, manager, id)).rejects.toThrow(
        "Choose one of this customer's properties.",
      );
      expect((await findQuote(tx, id)).status).toBe("DRAFT");
    });
  });
});
