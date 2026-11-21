import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DomainError, ForbiddenError } from "../customers/access";
import { archiveCustomer } from "../customers/customers";
import { formatCustomerNumber } from "../customers/number";
import { anonymiseCustomer } from "../customers/privacy";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { createQuote } from "./drafts";
import { issueQuote, withdrawQuote } from "./issue";
import { acceptQuote, declineQuote, getPropertyAgreement, reverseAcceptance } from "./outcomes";
import { addDays, fromDateString, todaySA } from "./reference";
import { acceptSchema } from "./schemas";
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
  owner,
} from "./test-helpers";

const accept = (over: Record<string, unknown> = {}) =>
  acceptSchema.parse({
    method: "WHATSAPP",
    acceptedBy: "A. Client",
    startDate: addDays(todaySA(), 7),
    chosenLineIds: [],
    ...over,
  });

describe.skipIf(!dbTestsEnabled)("accepting a quote", () => {
  it("accepts, records who and how, and turns a lead into an active customer", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx, { status: "LEAD" });
      const result = await acceptQuote(tx, manager, q.id, accept({ note: "Said yes on WhatsApp" }));
      expect(result.customerFlag).toBeNull();
      const row = await findQuote(tx, q.id);
      expect(row).toMatchObject({
        status: "ACCEPTED",
        acceptedMethod: "WHATSAPP",
        acceptedByName: "A. Client",
        acceptedByStaffId: manager.id,
      });
      expect(row.acceptedStartDate).toBeInstanceOf(Date);
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: q.customerId } });
      expect(customer.status).toBe("ACTIVE");

      const customerAudit = await tx.auditLog.findMany({
        where: { entityId: q.customerId, action: "customer.activated" },
      });
      expect(customerAudit[0]?.after).toEqual({ from: "LEAD", via: "quote" });
      const quoteAudit = await tx.auditLog.findMany({
        where: { entityId: q.id, action: "quote.accepted" },
      });
      expect(quoteAudit[0]?.after).toEqual({
        method: "WHATSAPP",
        optionsChosen: 0,
        customerFlag: null,
      });
      expect(JSON.stringify(quoteAudit)).not.toContain("A. Client");
      expect(JSON.stringify(quoteAudit)).not.toContain("Said yes");
    });
  });

  it("stores which optional add-ons were chosen, and only optional lines can be chosen", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      await fillDraft(tx, id, {
        lines: [monthlyLine(), optionalLine(), optionalLine({ description: "Other" })],
      });
      await issueQuote(tx, manager, id);
      const lines = (await findQuote(tx, id)).lines;
      const pricedId = lines[0]?.id ?? "";
      const optionId = lines[1]?.id ?? "";
      await expect(
        acceptQuote(tx, manager, id, accept({ chosenLineIds: [pricedId] })),
      ).rejects.toThrow("Only optional add-ons can be chosen.");
      await acceptQuote(tx, manager, id, accept({ chosenLineIds: [optionId] }));
      const after = (await findQuote(tx, id)).lines;
      expect(after.map((l) => l.chosen)).toEqual([false, true, false]);
    });
  });

  it("refuses an expired quote, a past start date, a repeat, and a draft", async () => {
    await withRollback(async (tx) => {
      const expired = await makeIssued(tx);
      await tx.quote.update({
        where: { id: expired.id },
        data: { validUntil: fromDateString(addDays(todaySA(), -1)) },
      });
      await expect(acceptQuote(tx, manager, expired.id, accept())).rejects.toThrow(
        "This quote has expired. Revise it to give it new dates.",
      );

      const q = await makeIssued(tx);
      await expect(
        acceptQuote(tx, manager, q.id, accept({ startDate: addDays(todaySA(), -1) })),
      ).rejects.toThrow("The start date must be today or later.");
      await acceptQuote(tx, manager, q.id, accept());
      await expect(acceptQuote(tx, manager, q.id, accept())).rejects.toThrow(
        "Only an issued quote can be accepted.",
      );

      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      await expect(acceptQuote(tx, manager, id, accept())).rejects.toBeInstanceOf(DomainError);
    });
  });

  it("flags a paused or archived customer and leaves them unchanged", async () => {
    await withRollback(async (tx) => {
      const paused = await makeIssued(tx, { status: "ACTIVE" });
      await tx.customer.update({ where: { id: paused.customerId }, data: { status: "PAUSED" } });
      expect((await acceptQuote(tx, manager, paused.id, accept())).customerFlag).toBe("PAUSED");
      const stillPaused = await tx.customer.findUniqueOrThrow({ where: { id: paused.customerId } });
      expect(stillPaused.status).toBe("PAUSED");

      const archived = await makeIssued(tx, { status: "ACTIVE" });
      await archiveCustomer(tx, manager, archived.customerId);
      expect((await acceptQuote(tx, manager, archived.id, accept())).customerFlag).toBe("ARCHIVED");
    });
  });

  it("makes the newest accepted monthly quote the agreement and ends the earlier one", async () => {
    await withRollback(async (tx) => {
      const first = await makeIssued(tx, { status: "ACTIVE" });
      await acceptQuote(tx, manager, first.id, accept());

      const { id: second } = await createQuote(tx, manager, {
        customerId: first.customerId,
        propertyId: first.propertyId,
      });
      await fillDraft(tx, second, { lines: [monthlyLine({ amountCents: 130000 })] });
      await issueQuote(tx, manager, second);
      await acceptQuote(tx, manager, second, accept());

      const ended = await findQuote(tx, first.id);
      expect(ended.agreementReplacedById).toBe(second);
      expect(ended.agreementEndedAt).toBeInstanceOf(Date);
      const agreement = await getPropertyAgreement(tx, manager, first.propertyId);
      expect(agreement.current?.id).toBe(second);
      expect(agreement.current?.totals.monthly).toBe(130000);
      expect(agreement.onceOff).toHaveLength(0);
    });
  });

  it("lists accepted once-off quotes separately and never replaces them", async () => {
    await withRollback(async (tx) => {
      const monthly = await makeIssued(tx, { status: "ACTIVE" });
      await acceptQuote(tx, manager, monthly.id, accept());
      const { id } = await createQuote(tx, manager, {
        customerId: monthly.customerId,
        propertyId: monthly.propertyId,
      });
      await fillDraft(tx, id, { lines: [onceOffLine()] });
      await issueQuote(tx, manager, id);
      await acceptQuote(tx, manager, id, accept());

      const agreement = await getPropertyAgreement(tx, manager, monthly.propertyId);
      expect(agreement.current?.id).toBe(monthly.id);
      expect(agreement.onceOff.map((q) => q.id)).toEqual([id]);
      expect((await findQuote(tx, monthly.id)).agreementEndedAt).toBeNull();
    });
  });

  it("declines with an optional reason, and only an issued quote can be declined", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      await declineQuote(tx, manager, q.id, { reason: "Too expensive" });
      const row = await findQuote(tx, q.id);
      expect(row).toMatchObject({ status: "DECLINED", declineReason: "Too expensive" });
      expect(row.declinedAt).toBeInstanceOf(Date);
      const audit = await tx.auditLog.findMany({
        where: { entityId: q.id, action: "quote.declined" },
      });
      expect(JSON.stringify(audit)).not.toContain("Too expensive");
      await expect(declineQuote(tx, manager, q.id, {})).rejects.toBeInstanceOf(DomainError);
    });
  });

  it("writes an agreement-ended audit line on the replaced quote", async () => {
    await withRollback(async (tx) => {
      const first = await makeIssued(tx, { status: "ACTIVE" });
      await acceptQuote(tx, manager, first.id, accept());
      const { id: second } = await createQuote(tx, manager, {
        customerId: first.customerId,
        propertyId: first.propertyId,
      });
      await fillDraft(tx, second, { lines: [monthlyLine({ amountCents: 130000 })] });
      await issueQuote(tx, manager, second);
      await acceptQuote(tx, manager, second, accept());
      const audit = await tx.auditLog.findMany({
        where: { entityId: first.id, action: "quote.agreement_ended" },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]?.after).toEqual({ replacedBy: second });
    });
  });

  it("shows a quote with monthly and once-off work as the current agreement only", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx, "ACTIVE");
      const { id } = await createQuote(tx, manager, c);
      await fillDraft(tx, id, { lines: [monthlyLine(), onceOffLine()] });
      await issueQuote(tx, manager, id);
      await acceptQuote(tx, manager, id, accept());
      const agreement = await getPropertyAgreement(tx, manager, c.propertyId);
      expect(agreement.current?.id).toBe(id);
      expect(agreement.onceOff).toHaveLength(0);
    });
  });

  it("hides an optional line that was not chosen and shows one that was", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx, "ACTIVE");
      const { id } = await createQuote(tx, manager, c);
      await fillDraft(tx, id, { lines: [monthlyLine(), optionalLine()] });
      await issueQuote(tx, manager, id);
      await acceptQuote(tx, manager, id, accept());
      const without = await getPropertyAgreement(tx, manager, c.propertyId);
      expect(without.current?.lines).toHaveLength(1);

      const d = await makeCustomer(tx, "ACTIVE");
      const { id: other } = await createQuote(tx, manager, d);
      await fillDraft(tx, other, { lines: [monthlyLine(), optionalLine()] });
      await issueQuote(tx, manager, other);
      const optionId = (await findQuote(tx, other)).lines[1]?.id ?? "";
      await acceptQuote(tx, manager, other, accept({ chosenLineIds: [optionId] }));
      const withIt = await getPropertyAgreement(tx, manager, d.propertyId);
      expect(withIt.current?.lines).toHaveLength(2);
    });
  });

  it("treats a once-off quote with a chosen monthly add-on as a monthly agreement", async () => {
    await withRollback(async (tx) => {
      const first = await makeIssued(tx, { status: "ACTIVE" });
      await acceptQuote(tx, manager, first.id, accept());
      const { id } = await createQuote(tx, manager, {
        customerId: first.customerId,
        propertyId: first.propertyId,
      });
      await fillDraft(tx, id, { lines: [onceOffLine(), optionalLine()] });
      await issueQuote(tx, manager, id);
      const optionId = (await findQuote(tx, id)).lines[1]?.id ?? "";
      await acceptQuote(tx, manager, id, accept({ chosenLineIds: [optionId] }));
      expect((await findQuote(tx, first.id)).agreementReplacedById).toBe(id);
      expect((await getPropertyAgreement(tx, manager, first.propertyId)).current?.id).toBe(id);
    });
  });

  it("counts a repeated add-on once", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      await fillDraft(tx, id, { lines: [monthlyLine(), optionalLine()] });
      await issueQuote(tx, manager, id);
      const optionId = (await findQuote(tx, id)).lines[1]?.id ?? "";
      await acceptQuote(tx, manager, id, accept({ chosenLineIds: [optionId, optionId] }));
      const audit = await tx.auditLog.findMany({
        where: { entityId: id, action: "quote.accepted" },
      });
      expect(audit[0]?.after).toMatchObject({ optionsChosen: 1 });
    });
  });

  it("refuses a withdrawn or a declined quote", async () => {
    await withRollback(async (tx) => {
      const withdrawn = await makeIssued(tx);
      await withdrawQuote(tx, manager, withdrawn.id);
      await expect(acceptQuote(tx, manager, withdrawn.id, accept())).rejects.toThrow(
        "Only an issued quote can be accepted.",
      );
      const declined = await makeIssued(tx);
      await declineQuote(tx, manager, declined.id, {});
      await expect(acceptQuote(tx, manager, declined.id, accept())).rejects.toThrow(
        "Only an issued quote can be accepted.",
      );
    });
  });

  it("leaves an archived customer archived after acceptance", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx, { status: "ACTIVE" });
      await archiveCustomer(tx, manager, q.customerId);
      await acceptQuote(tx, manager, q.id, accept());
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: q.customerId } });
      expect(customer.status).toBe("ARCHIVED");
    });
  });

  it("refuses to accept or decline a quote for an anonymised customer", async () => {
    await withRollback(async (tx) => {
      const a = await makeIssued(tx);
      const b = await makeIssued(tx);
      for (const q of [a, b]) {
        const { number } = await tx.customer.findUniqueOrThrow({ where: { id: q.customerId } });
        await anonymiseCustomer(tx, owner, q.customerId, formatCustomerNumber(number));
      }
      const message = "This customer has been anonymised and cannot be changed.";
      await expect(acceptQuote(tx, manager, a.id, accept())).rejects.toThrow(message);
      await expect(declineQuote(tx, manager, b.id, { reason: "No" })).rejects.toThrow(message);
    });
  });
});

describe.skipIf(!dbTestsEnabled)("reversing an acceptance", () => {
  it("lets only the owner reverse it, with a note, and restores the earlier agreement", async () => {
    await withRollback(async (tx) => {
      const first = await makeIssued(tx, { status: "ACTIVE" });
      await acceptQuote(tx, manager, first.id, accept());
      const { id: second } = await createQuote(tx, manager, {
        customerId: first.customerId,
        propertyId: first.propertyId,
      });
      await fillDraft(tx, second, { lines: [monthlyLine({ amountCents: 130000 })] });
      await issueQuote(tx, manager, second);
      await acceptQuote(tx, manager, second, accept());

      await expect(
        reverseAcceptance(tx, manager, second, "Entered by mistake"),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(reverseAcceptance(tx, owner, second, "  ")).rejects.toThrow(
        "Say why the acceptance is being reversed.",
      );
      await expect(reverseAcceptance(tx, owner, first.id, "Mistake")).rejects.toThrow(
        "A later quote has replaced this agreement. Reverse that one first.",
      );

      await reverseAcceptance(tx, owner, second, "Entered by mistake");
      const row = await findQuote(tx, second);
      expect(row).toMatchObject({
        status: "ISSUED",
        acceptedAt: null,
        acceptedByName: null,
        acceptedStartDate: null,
        reversalNote: "Entered by mistake",
      });
      expect(row.reversedAt).toBeInstanceOf(Date);
      expect((await findQuote(tx, first.id)).agreementEndedAt).toBeNull();
      const agreement = await getPropertyAgreement(tx, manager, first.propertyId);
      expect(agreement.current?.id).toBe(first.id);

      const audit = await tx.auditLog.findMany({
        where: { entityId: second, action: "quote.reversed" },
      });
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain("Entered by mistake");
    });
  });

  it("clears the chosen add-ons so a fresh acceptance starts clean", async () => {
    await withRollback(async (tx) => {
      const c = await makeCustomer(tx);
      const { id } = await createQuote(tx, manager, c);
      await fillDraft(tx, id, { lines: [monthlyLine(), optionalLine()] });
      await issueQuote(tx, manager, id);
      const optionId = (await findQuote(tx, id)).lines[1]?.id ?? "";
      await acceptQuote(tx, manager, id, accept({ chosenLineIds: [optionId] }));
      await reverseAcceptance(tx, owner, id, "Wrong add-ons");
      expect((await findQuote(tx, id)).lines.map((l) => l.chosen)).toEqual([false, false]);
    });
  });

  it("refuses to reverse a quote that is not accepted, or a note that is too long", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      await expect(reverseAcceptance(tx, owner, q.id, "Mistake")).rejects.toThrow(
        "Only an accepted quote can be reversed.",
      );
      await expect(reverseAcceptance(tx, owner, q.id, "x".repeat(301))).rejects.toThrow(
        "Keep the reason to 300 characters or fewer.",
      );
    });
  });

  it("refuses to reverse an acceptance for an anonymised customer", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx, { status: "ACTIVE" });
      await acceptQuote(tx, manager, q.id, accept());
      const { number } = await tx.customer.findUniqueOrThrow({ where: { id: q.customerId } });
      await anonymiseCustomer(tx, owner, q.customerId, formatCustomerNumber(number));
      await expect(reverseAcceptance(tx, owner, q.id, "Mistake")).rejects.toThrow(
        "This customer has been anonymised and cannot be changed.",
      );
    });
  });

  it("refuses crew every function, and a missing quote is not found", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx);
      await expect(acceptQuote(tx, crew, q.id, accept())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(declineQuote(tx, crew, q.id, {})).rejects.toBeInstanceOf(ForbiddenError);
      await expect(reverseAcceptance(tx, crew, q.id, "x")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getPropertyAgreement(tx, crew, q.propertyId)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(acceptQuote(tx, manager, randomUUID(), accept())).rejects.toBeInstanceOf(
        DomainError,
      );
    });
  });
});
