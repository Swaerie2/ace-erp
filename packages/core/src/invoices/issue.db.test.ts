import { describe, expect, it } from "vitest";
import { DomainError, ForbiddenError } from "../customers/access";
import { formatCustomerNumber } from "../customers/number";
import { addDays, fromDateString, toDateString, todaySA, yearSA } from "../quotes/reference";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { listInvoiceActivity } from "./activity";
import { createOnceOffDraft, saveInvoiceDraft } from "./drafts";
import { issueAllDrafts, issueInvoice, voidInvoice } from "./issue";
import { invoiceSnapshotSchema } from "./schemas";
import { INVOICE_MESSAGES, InvoiceDraftConflictError, InvoiceIssueError } from "./store";
import {
  auditFor,
  crew,
  fillBankDetails,
  makeBillingCustomer,
  makeIssuedInvoice,
  makePayment,
  manager,
  sameTx,
} from "./test-helpers";

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];

/** A once-off draft with one line, made through the real draft functions. */
async function onceOffDraft(tx: Tx, customerId: string, amountCents = 50000) {
  const { id } = await createOnceOffDraft(tx, manager, { customerId });
  await saveInvoiceDraft(tx, manager, id, {
    version: 1,
    dueDate: null,
    lines: [{ id: null, kind: "ONCE_OFF", description: "Garden clean-up", amountCents }],
  });
  return id;
}

async function prepare(tx: Tx) {
  await fillBankDetails(tx);
  await tx.invoiceSettings.update({ where: { id: "singleton" }, data: { onceOffDueDays: 14 } });
}

describe.skipIf(!dbTestsEnabled)("issuing an invoice", () => {
  it("numbers it, freezes the recipient, bank details and total, fingerprints it and audits fixed words", async () => {
    await withRollback(async (tx) => {
      await prepare(tx);
      const c = await makeBillingCustomer(tx);
      const id = await onceOffDraft(tx, c.customerId);
      await expect(issueInvoice(tx, crew, id)).rejects.toBeInstanceOf(ForbiddenError);
      const issued = await issueInvoice(tx, manager, id);
      expect(issued.reference).toMatch(new RegExp(`^INV-${yearSA()}-\\d{4,}$`));
      const row = await tx.invoice.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe("ISSUED");
      expect(row.numberYear).toBe(yearSA());
      expect(row.totalCents).toBe(50000);
      expect(row.recipientName).toBe(c.displayName);
      expect(row.recipientAddress).toBe("1 Test Road, Testville");
      expect(toDateString(row.dueDate ?? new Date(0))).toBe(addDays(todaySA(), 14));
      expect(row.issuedById).toBe(manager.id);
      expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.emailStatus).toBe("NONE");
      const snapshot = invoiceSnapshotSchema.parse(row.bankSnapshot);
      expect(snapshot.bank.accountNumber).toBe("1234567890");
      expect(snapshot.paymentReference).toBe(formatCustomerNumber(c.number));

      // Audit lines written in one transaction can share `at`, so the order is not relied on here.
      const audit = await auditFor(tx, "invoice", id);
      expect(audit.map((a) => a.action).sort()).toEqual(["invoice.drafted", "invoice.issued"]);
      expect(audit.find((a) => a.action === "invoice.issued")?.after).toEqual({ lineCount: 1 });
      const text = JSON.stringify(audit);
      expect(text).not.toContain(c.displayName);
      expect(text).not.toContain("Test Road");

      await expect(listInvoiceActivity(tx, crew, id)).rejects.toBeInstanceOf(ForbiddenError);
      const history = await listInvoiceActivity(tx, manager, id);
      expect(history.map((h) => h.action).sort()).toEqual(["invoice.drafted", "invoice.issued"]);
      // Newest first (ties allowed).
      const times = history.map((h) => h.at.getTime());
      expect(times).toEqual([...times].sort((x, y) => y - x));
      expect(history.every((h) => h.actorId === manager.id && h.actorType === "STAFF")).toBe(true);

      await expect(issueInvoice(tx, manager, id)).rejects.toThrow("Only a draft can be issued.");
    });
  });

  it("refuses without bank details, and lists every problem of an incomplete draft", async () => {
    await withRollback(async (tx) => {
      await tx.invoiceSettings.update({
        where: { id: "singleton" },
        data: { bankName: "", accountHolder: "", accountNumber: "", branchCode: "" },
      });
      const c = await makeBillingCustomer(tx);
      const id = await onceOffDraft(tx, c.customerId);
      const noBank = await issueInvoice(tx, manager, id).catch((e: unknown) => e);
      expect(noBank).toBeInstanceOf(InvoiceIssueError);
      expect((noBank as InvoiceIssueError).problems).toEqual([
        "Enter ACE's bank details in Invoice settings before issuing.",
      ]);

      await fillBankDetails(tx);
      const empty = (await createOnceOffDraft(tx, manager, { customerId: c.customerId })).id;
      const problems = await issueInvoice(tx, manager, empty).catch((e: unknown) => e);
      expect((problems as InvoiceIssueError).problems).toEqual([
        "Add at least one line.",
        "The total must be above zero.",
      ]);
      // A due date in the past cannot be saved through the draft screen, so it is written directly.
      const late = await onceOffDraft(tx, c.customerId, 1000);
      await tx.invoice.update({
        where: { id: late },
        data: { dueDate: fromDateString("2020-01-31") },
      });
      const past = await issueInvoice(tx, manager, late).catch((e: unknown) => e);
      expect((past as InvoiceIssueError).problems).toEqual([
        "The due date has passed. Change it before issuing.",
      ]);
      const rows = await tx.invoice.findMany({
        where: { id: { in: [id, empty, late] } },
        select: { status: true },
      });
      expect(rows.map((r) => r.status)).toEqual(["DRAFT", "DRAFT", "DRAFT"]);
    });
  });

  it("addresses a complex's invoice to its agency as the billing stands at issue", async () => {
    await withRollback(async (tx) => {
      await prepare(tx);
      const agency = await makeBillingCustomer(tx);
      const complex = await makeBillingCustomer(tx);
      const id = await onceOffDraft(tx, complex.customerId);
      // the complex is put under the agency after the draft was made
      await tx.customer.update({
        where: { id: complex.customerId },
        data: { managedById: agency.customerId, billsToManager: true },
      });
      await issueInvoice(tx, manager, id);
      const row = await tx.invoice.findUniqueOrThrow({ where: { id } });
      expect(row.billToCustomerId).toBe(agency.customerId);
      expect(row.customerId).toBe(complex.customerId);
      expect(row.recipientName).toBe(agency.displayName);
      expect(invoiceSnapshotSchema.parse(row.bankSnapshot).paymentReference).toBe(
        formatCustomerNumber(agency.number),
      );
    });
  });

  it("refuses when the agency billed is archived or anonymised, or the customer is archived", async () => {
    await withRollback(async (tx) => {
      await prepare(tx);
      const agency = await makeBillingCustomer(tx);
      const complex = await makeBillingCustomer(tx, {
        managedById: agency.customerId,
        billsToManager: true,
      });
      const id = await onceOffDraft(tx, complex.customerId);
      await tx.customer.update({
        where: { id: agency.customerId },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });
      const archived = await issueInvoice(tx, manager, id).catch((e: unknown) => e);
      expect((archived as InvoiceIssueError).problems).toEqual([INVOICE_MESSAGES.billToInactive]);

      await tx.customer.update({
        where: { id: agency.customerId },
        data: { status: "ACTIVE", archivedAt: null, anonymisedAt: new Date() },
      });
      const anonymised = await issueInvoice(tx, manager, id).catch((e: unknown) => e);
      expect((anonymised as InvoiceIssueError).problems).toEqual([INVOICE_MESSAGES.billToInactive]);

      const own = await makeBillingCustomer(tx);
      const ownDraft = await onceOffDraft(tx, own.customerId);
      await tx.customer.update({
        where: { id: own.customerId },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });
      const ownArchived = await issueInvoice(tx, manager, ownDraft).catch((e: unknown) => e);
      expect((ownArchived as InvoiceIssueError).problems).toEqual([INVOICE_MESSAGES.archived]);
      await tx.customer.update({
        where: { id: own.customerId },
        data: { anonymisedAt: new Date() },
      });
      const ownAnonymised = await issueInvoice(tx, manager, ownDraft).catch((e: unknown) => e);
      expect((ownAnonymised as InvoiceIssueError).problems).toEqual([INVOICE_MESSAGES.anonymised]);

      const rows = await tx.invoice.findMany({
        where: { id: { in: [id, ownDraft] } },
        select: { status: true },
      });
      expect(rows.map((r) => r.status)).toEqual(["DRAFT", "DRAFT"]);
    });
  });

  it("gives consecutive numbers, and issue-all carries on past a draft that cannot be issued", async () => {
    await withRollback(async (tx) => {
      await prepare(tx);
      const c = await makeBillingCustomer(tx);
      const a = await onceOffDraft(tx, c.customerId, 1000);
      const bad = (await createOnceOffDraft(tx, manager, { customerId: c.customerId })).id;
      const b = await onceOffDraft(tx, c.customerId, 2000);
      await expect(issueAllDrafts(tx, crew, { run: sameTx(tx), only: [a] })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      const result = await issueAllDrafts(tx, manager, {
        run: sameTx(tx),
        only: [a, bad, b, "not-a-uuid"],
      });
      expect(result.issued.map((i) => i.id).sort()).toEqual([a, b].sort());
      expect(result.failed).toEqual([
        { id: bad, problem: "Add at least one line.\nThe total must be above zero." },
      ]);
      const rows = await tx.invoice.findMany({
        where: { id: { in: [a, b] } },
        select: { numberSeq: true },
      });
      const seqs = rows.map((r) => r.numberSeq ?? 0).sort((x, y) => x - y);
      expect(seqs).toHaveLength(2);
      expect((seqs[1] ?? 0) - (seqs[0] ?? 0)).toBe(1);
    });
  });

  it("refuses to issue a draft that was saved again after the issuer opened it", async () => {
    await withRollback(async (tx) => {
      await prepare(tx);
      const c = await makeBillingCustomer(tx);
      // onceOffDraft saves once, so the draft is at version 2: the issuer "opened" version 2.
      const id = await onceOffDraft(tx, c.customerId);
      await saveInvoiceDraft(tx, manager, id, {
        version: 2,
        dueDate: null,
        lines: [
          { id: null, kind: "ONCE_OFF", description: "Changed by someone else", amountCents: 9 },
        ],
      });
      const stale = await issueInvoice(tx, manager, id, { expectedVersion: 2 }).catch(
        (e: unknown) => e,
      );
      expect(stale).toBeInstanceOf(InvoiceDraftConflictError);
      expect((stale as Error).message).toBe(INVOICE_MESSAGES.issueConflict);
      expect(INVOICE_MESSAGES.issueConflict).toBe(
        "This draft was changed after you opened it. Reload it, check it, then issue it.",
      );
      const row = await tx.invoice.findUniqueOrThrow({
        where: { id },
        select: { status: true, numberSeq: true },
      });
      expect(row).toEqual({ status: "DRAFT", numberSeq: null });
      expect((await auditFor(tx, "invoice", id)).map((a) => a.action)).not.toContain(
        "invoice.issued",
      );

      // The current version issues.
      const issued = await issueInvoice(tx, manager, id, { expectedVersion: 3 });
      expect(issued.id).toBe(id);

      // Without a version (older callers) it still issues.
      const other = await onceOffDraft(tx, c.customerId, 1000);
      expect((await issueInvoice(tx, manager, other)).id).toBe(other);
    });
  });

  it("refuses a total too large to store with the usual list of problems", async () => {
    await withRollback(async (tx) => {
      await prepare(tx);
      const c = await makeBillingCustomer(tx);
      const { id } = await createOnceOffDraft(tx, manager, { customerId: c.customerId });
      await saveInvoiceDraft(tx, manager, id, {
        version: 1,
        dueDate: null,
        lines: Array.from({ length: 22 }, () => ({
          id: null,
          kind: "ONCE_OFF" as const,
          description: "Large job",
          amountCents: 100_000_000,
        })),
      });
      const refused = await issueInvoice(tx, manager, id).catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(InvoiceIssueError);
      expect((refused as InvoiceIssueError).problems).toEqual(["The total is too large to issue."]);
      const row = await tx.invoice.findUniqueOrThrow({ where: { id }, select: { status: true } });
      expect(row.status).toBe("DRAFT");
    });
  });

  it("issue-all with a stale version fails only that draft", async () => {
    await withRollback(async (tx) => {
      await prepare(tx);
      const c = await makeBillingCustomer(tx);
      const a = await onceOffDraft(tx, c.customerId, 1000);
      const b = await onceOffDraft(tx, c.customerId, 2000);
      await saveInvoiceDraft(tx, manager, b, {
        version: 2,
        dueDate: null,
        lines: [{ id: null, kind: "ONCE_OFF", description: "Changed", amountCents: 3000 }],
      });
      const result = await issueAllDrafts(tx, manager, {
        run: sameTx(tx),
        only: [a, b],
        expectedVersions: { [a.toUpperCase()]: 2, [b]: 2 },
      });
      expect(result.issued.map((i) => i.id)).toEqual([a]);
      expect(result.failed).toEqual([{ id: b, problem: INVOICE_MESSAGES.issueConflict }]);
      const row = await tx.invoice.findUniqueOrThrow({
        where: { id: b },
        select: { status: true },
      });
      expect(row.status).toBe("DRAFT");
    });
  });
});

describe.skipIf(!dbTestsEnabled)("voiding an invoice", () => {
  it("is refused while a live payment is allocated, then voids with the reason kept off the audit line", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      const id = await makeIssuedInvoice(tx, { customerId: c.customerId, dueDate: "2099-01-31" });
      const payment = await makePayment(tx, {
        payerCustomerId: c.customerId,
        amountCents: 1000,
        receivedOn: "2026-11-01",
        allocations: [{ invoiceId: id, amountCents: 1000 }],
      });
      await expect(voidInvoice(tx, manager, id, "ZZ wrong amount")).rejects.toThrow(
        "This invoice has payments allocated to it. Remove the allocations or void the payments first.",
      );
      // payments_void_pair: voidedAt and voidedById are set together.
      await tx.payment.update({
        where: { id: payment },
        data: { voidedAt: new Date(), voidedById: manager.id, voidReason: "x" },
      });
      await expect(voidInvoice(tx, manager, id, "   ")).rejects.toThrow("Say why in a few words.");
      await expect(voidInvoice(tx, manager, id, "x".repeat(301))).rejects.toThrow(
        "Keep the reason to 300 characters or fewer.",
      );
      await voidInvoice(tx, manager, id, "ZZ wrong amount");
      const row = await tx.invoice.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe("VOID");
      expect(row.voidReason).toBe("ZZ wrong amount");
      expect(row.voidedById).toBe(manager.id);
      const audit = await auditFor(tx, "invoice", id);
      expect(audit.map((a) => a.action)).toEqual(["invoice.voided"]);
      expect(audit[0]?.after).toBeNull();
      expect(JSON.stringify(audit)).not.toContain("ZZ wrong amount");
      await expect(voidInvoice(tx, manager, id, "again")).rejects.toThrow(
        "Only an issued invoice can be voided. Delete a draft instead.",
      );
    });
  });

  it("refuses a draft and crew", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      const draft = await tx.invoice.create({
        data: { customerId: c.customerId, billToCustomerId: c.customerId, kind: "ONCE_OFF" },
        select: { id: true },
      });
      await expect(voidInvoice(tx, crew, draft.id, "x")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(voidInvoice(tx, manager, draft.id, "x")).rejects.toBeInstanceOf(DomainError);
      await expect(voidInvoice(tx, manager, "not-a-uuid", "x")).rejects.toThrow(
        "That invoice could not be found.",
      );
      const row = await tx.invoice.findUniqueOrThrow({
        where: { id: draft.id },
        select: { status: true },
      });
      expect(row.status).toBe("DRAFT");
      expect(await auditFor(tx, "invoice", draft.id)).toEqual([]);
    });
  });
});
