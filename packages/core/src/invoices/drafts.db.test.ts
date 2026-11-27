import { describe, expect, it } from "vitest";
import { DomainError, ForbiddenError } from "../customers/access";
import { addDays, fromDateString, todaySA } from "../quotes/reference";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import {
  createOnceOffDraft,
  deleteInvoiceDraft,
  getInvoice,
  latestDueDate,
  listAcceptedOnceOffQuotes,
  listCustomerInvoices,
  listDraftsForReview,
  listInvoices,
  saveInvoiceDraft,
} from "./drafts";
import { InvoiceDraftConflictError } from "./store";
import {
  auditFor,
  crew,
  makeAcceptedQuote,
  makeBillingCustomer,
  makeIssuedInvoice,
  makePayment,
  manager,
  onceOffQuoteLine,
  optionalLine,
  serviceLine,
} from "./test-helpers";

const DUE_RANGE = "Choose a due date from today up to one year from today.";

describe.skipIf(!dbTestsEnabled)("once-off drafts", () => {
  it("pre-fills from an accepted quote's once-off work, labelled with the property, billed to the agency", async () => {
    await withRollback(async (tx) => {
      const agency = await makeBillingCustomer(tx);
      const complex = await makeBillingCustomer(tx, { managedById: agency.customerId });
      const quote = await makeAcceptedQuote(tx, {
        customerId: complex.customerId,
        propertyId: complex.propertyId,
        startDate: "2026-12-01",
        lines: [
          serviceLine(115000),
          onceOffQuoteLine(240000),
          { ...optionalLine(30000, true, "Tree trim"), billing: "ONCE_OFF", frequency: null },
          { ...optionalLine(50000, false, "Not chosen"), billing: "ONCE_OFF", frequency: null },
        ],
      });
      await expect(
        createOnceOffDraft(tx, crew, { customerId: complex.customerId }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const offered = await listAcceptedOnceOffQuotes(tx, manager, complex.customerId);
      expect(offered.map((q) => [q.id, q.onceOffCents, q.alreadyInvoiced])).toEqual([
        [quote.quoteId, 270000, false],
      ]);
      const { id } = await createOnceOffDraft(tx, manager, {
        customerId: complex.customerId,
        fromQuoteId: quote.quoteId,
      });
      const inv = await getInvoice(tx, manager, id);
      expect(inv?.status).toBe("DRAFT");
      expect(inv?.kind).toBe("ONCE_OFF");
      expect(inv?.billTo.id).toBe(agency.customerId);
      expect(inv?.sourceQuoteId).toBe(quote.quoteId);
      expect(inv?.dueDateString).toBeNull();
      expect(inv?.lines.map((l) => [l.kind, l.description, l.amountCents])).toEqual([
        ["ONCE_OFF", `${complex.propertyLabel}: Once-off clean-up`, 240000],
        ["ONCE_OFF", `${complex.propertyLabel}: Tree trim`, 30000],
      ]);
      expect(inv?.totalCents).toBe(270000);
      const audit = await auditFor(tx, "invoice", id);
      expect(audit.map((a) => a.action)).toEqual(["invoice.drafted"]);
      expect(audit[0]?.after).toEqual({ kind: "ONCE_OFF", fromQuote: true, lineCount: 2 });
      expect(
        (await listAcceptedOnceOffQuotes(tx, manager, complex.customerId))[0]?.alreadyInvoiced,
      ).toBe(true);
      await expect(
        createOnceOffDraft(tx, manager, {
          customerId: complex.customerId,
          fromQuoteId: quote.quoteId,
        }),
      ).rejects.toThrow("This quote has already been invoiced.");
    });
  });

  it("refuses another customer's quote, and an archived customer", async () => {
    await withRollback(async (tx) => {
      const a = await makeBillingCustomer(tx);
      const b = await makeBillingCustomer(tx);
      const quote = await makeAcceptedQuote(tx, {
        customerId: a.customerId,
        propertyId: a.propertyId,
        startDate: "2026-12-01",
        lines: [onceOffQuoteLine(1000)],
      });
      await expect(
        createOnceOffDraft(tx, manager, { customerId: b.customerId, fromQuoteId: quote.quoteId }),
      ).rejects.toThrow("Only an accepted quote of this customer can be invoiced.");
      await expect(
        createOnceOffDraft(tx, manager, { customerId: b.customerId, fromQuoteId: "not-an-id" }),
      ).rejects.toThrow("Only an accepted quote of this customer can be invoiced.");
      const archived = await makeBillingCustomer(tx, { status: "ARCHIVED" });
      await expect(
        createOnceOffDraft(tx, manager, { customerId: archived.customerId }),
      ).rejects.toThrow("Restore this customer before invoicing.");
    });
  });
});

describe.skipIf(!dbTestsEnabled)("saving and deleting drafts", () => {
  it("guards the version, keeps a late fee's target, adds and removes lines, and skips an unchanged save", async () => {
    await withRollback(async (tx) => {
      const today = todaySA();
      const dueA = addDays(today, 30);
      const dueB = addDays(today, 29);
      const c = await makeBillingCustomer(tx);
      const overdue = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        dueDate: "2026-01-31",
      });
      const draft = await tx.invoice.create({
        data: {
          customerId: c.customerId,
          billToCustomerId: c.customerId,
          kind: "MONTHLY",
          serviceMonth: fromDateString("2099-06-01"),
          dueDate: fromDateString(dueA),
          lines: {
            create: [
              { sortOrder: 1, kind: "SERVICE", description: "Main: Garden", amountCents: 115000 },
              {
                sortOrder: 2,
                kind: "LATE_FEE",
                description: "Late payment fee",
                amountCents: 10000,
                forInvoiceId: overdue,
              },
            ],
          },
        },
        select: { id: true, lines: { orderBy: { sortOrder: "asc" }, select: { id: true } } },
      });
      const [serviceId, feeId] = draft.lines.map((l) => l.id);
      const lines = [
        {
          id: serviceId ?? null,
          kind: "SERVICE" as const,
          description: "Main: Garden",
          amountCents: 115000,
        },
        {
          id: feeId ?? null,
          kind: "LATE_FEE" as const,
          description: "Late payment fee",
          amountCents: 10000,
        },
      ];
      const same = await saveInvoiceDraft(tx, manager, draft.id, {
        version: 1,
        dueDate: dueA,
        lines,
      });
      expect(same.version).toBe(1);

      const saved = await saveInvoiceDraft(tx, manager, draft.id, {
        version: 1,
        dueDate: dueB,
        lines: [
          lines[1]!,
          { id: null, kind: "ADJUSTMENT", description: "Discount", amountCents: -5000 },
        ],
      });
      expect(saved.version).toBe(2);
      const inv = await getInvoice(tx, manager, draft.id);
      expect(inv?.dueDateString).toBe(dueB);
      expect(inv?.lines.map((l) => [l.kind, l.amountCents, l.forInvoiceId])).toEqual([
        ["LATE_FEE", 10000, overdue],
        ["ADJUSTMENT", -5000, null],
      ]);
      expect(inv?.totalCents).toBe(5000);

      await expect(
        saveInvoiceDraft(tx, manager, draft.id, { version: 1, dueDate: dueB, lines: [] }),
      ).rejects.toBeInstanceOf(InvoiceDraftConflictError);
      await expect(
        saveInvoiceDraft(tx, manager, draft.id, {
          version: 2,
          dueDate: dueB,
          lines: [{ id: null, kind: "LATE_FEE", description: "Fee", amountCents: 100 }],
        }),
      ).rejects.toThrow("Choose service, adjustment or once-off work for a new line.");
      await expect(
        saveInvoiceDraft(tx, manager, draft.id, {
          version: 2,
          dueDate: dueB,
          lines: [{ id: null, kind: "SERVICE", description: "Garden", amountCents: -100 }],
        }),
      ).rejects.toThrow("Only an adjustment can be negative.");
      await expect(
        saveInvoiceDraft(tx, manager, draft.id, { version: 2, dueDate: null, lines: [] }),
      ).rejects.toThrow("A monthly invoice needs a due date.");
      // The same line twice is refused by the draft schema, whatever its letter case.
      const fee = lines[1]!;
      await expect(
        saveInvoiceDraft(tx, manager, draft.id, {
          version: 2,
          dueDate: dueB,
          lines: [fee, { ...fee, id: fee.id?.toUpperCase() ?? null }],
        }),
      ).rejects.toThrow("Each line can appear only once.");
      // Nothing above changed the draft.
      expect((await getInvoice(tx, manager, draft.id))?.draftVersion).toBe(2);
      // Draft saves are not audited.
      expect(await auditFor(tx, "invoice", draft.id)).toEqual([]);
    });
  });

  it("keeps a new due date between today and one year from today, and lets a stored one stand", async () => {
    await withRollback(async (tx) => {
      const today = todaySA();
      const latest = latestDueDate(today);
      expect(latest > addDays(today, 364)).toBe(true);
      expect(latest <= addDays(today, 366)).toBe(true);
      const c = await makeBillingCustomer(tx);
      // A monthly draft from a run for an earlier month: its due date has already passed.
      const pastDue = addDays(today, -10);
      const draft = await tx.invoice.create({
        data: {
          customerId: c.customerId,
          billToCustomerId: c.customerId,
          kind: "MONTHLY",
          serviceMonth: fromDateString("2099-07-01"),
          dueDate: fromDateString(pastDue),
          lines: {
            create: [{ sortOrder: 1, kind: "SERVICE", description: "Garden", amountCents: 1000 }],
          },
        },
        select: { id: true },
      });
      // A save writes the lines again (with new ids), so each save here sends a new line.
      const line = (amountCents: number) => ({
        id: null,
        kind: "SERVICE" as const,
        description: "Garden",
        amountCents,
      });
      // Changing a line while keeping the stored (passed) due date is allowed: issuing refuses it later.
      const kept = await saveInvoiceDraft(tx, manager, draft.id, {
        version: 1,
        dueDate: pastDue,
        lines: [line(2000)],
      });
      expect(kept.version).toBe(2);
      // A new due date must be from today up to one year from today.
      for (const bad of [addDays(today, -1), addDays(latest, 1), "2099-05-31"]) {
        await expect(
          saveInvoiceDraft(tx, manager, draft.id, {
            version: 2,
            dueDate: bad,
            lines: [line(2000)],
          }),
        ).rejects.toThrow(DUE_RANGE);
      }
      expect(
        (
          await saveInvoiceDraft(tx, manager, draft.id, {
            version: 2,
            dueDate: today,
            lines: [line(2000)],
          })
        ).version,
      ).toBe(3);
      expect(
        (
          await saveInvoiceDraft(tx, manager, draft.id, {
            version: 3,
            dueDate: latest,
            lines: [line(2000)],
          })
        ).version,
      ).toBe(4);
      expect((await getInvoice(tx, manager, draft.id))?.dueDateString).toBe(latest);
      // A once-off draft may leave the due date empty (the default applies at issue).
      const { id } = await createOnceOffDraft(tx, manager, { customerId: c.customerId });
      await expect(
        saveInvoiceDraft(tx, manager, id, {
          version: 1,
          dueDate: addDays(today, -1),
          lines: [],
        }),
      ).rejects.toThrow(DUE_RANGE);
      expect(
        (
          await saveInvoiceDraft(tx, manager, id, {
            version: 1,
            dueDate: null,
            lines: [{ id: null, kind: "ONCE_OFF", description: "Clean-up", amountCents: 500 }],
          })
        ).version,
      ).toBe(2);
    });
  });

  it("refuses to change or delete an issued invoice, and deletes a draft with its lines", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      const issued = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        dueDate: "2099-01-31",
      });
      await expect(
        saveInvoiceDraft(tx, manager, issued, { version: 1, dueDate: null, lines: [] }),
      ).rejects.toThrow("Only a draft can be changed.");
      await expect(deleteInvoiceDraft(tx, manager, issued)).rejects.toThrow(
        "Only a draft can be deleted.",
      );
      const { id } = await createOnceOffDraft(tx, manager, { customerId: c.customerId });
      await saveInvoiceDraft(tx, manager, id, {
        version: 1,
        dueDate: null,
        lines: [{ id: null, kind: "ONCE_OFF", description: "Clean-up", amountCents: 50000 }],
      });
      await deleteInvoiceDraft(tx, manager, id);
      expect(await tx.invoice.findUnique({ where: { id }, select: { id: true } })).toBeNull();
      expect(await tx.invoiceLine.count({ where: { invoiceId: id } })).toBe(0);
      // Rows written in one transaction can share `at`, so compare without relying on the order.
      expect((await auditFor(tx, "invoice", id)).map((a) => a.action).sort()).toEqual([
        "invoice.deleted_draft",
        "invoice.drafted",
      ]);
    });
  });
});

describe.skipIf(!dbTestsEnabled)("reading invoices", () => {
  it("works out balances and statuses, and filters and searches the list", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      const overdue = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        dueDate: "2026-01-31",
        totalCents: 100000,
      });
      const paid = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        dueDate: "2099-01-31",
        totalCents: 50000,
      });
      await makePayment(tx, {
        payerCustomerId: c.customerId,
        amountCents: 80000,
        receivedOn: "2026-02-01",
        allocations: [
          { invoiceId: overdue, amountCents: 30000 },
          { invoiceId: paid, amountCents: 50000 },
        ],
      });
      // a voided payment never counts
      await makePayment(tx, {
        payerCustomerId: c.customerId,
        amountCents: 70000,
        receivedOn: "2026-02-02",
        allocations: [{ invoiceId: overdue, amountCents: 70000 }],
        voided: true,
      });
      const view = await getInvoice(tx, manager, overdue);
      expect(view).toMatchObject({
        allocatedCents: 30000,
        balanceCents: 70000,
        displayStatus: "OVERDUE",
      });
      expect((await getInvoice(tx, manager, paid))?.displayStatus).toBe("PAID");

      const overdueList = await listInvoices(tx, manager, { status: "OVERDUE", q: c.displayName });
      expect(overdueList.items.map((i) => i.id)).toEqual([overdue]);
      const paidList = await listInvoices(tx, manager, { status: "PAID", q: c.displayName });
      expect(paidList.items.map((i) => i.id)).toEqual([paid]);

      const mine = await listCustomerInvoices(tx, manager, c.customerId);
      expect(mine.items.map((i) => i.id).sort()).toEqual([overdue, paid].sort());
      expect(mine.owedCents).toBe(70000);
      expect(mine.creditCents).toBe(0);
      expect(mine.payments.map((p) => p.voided).sort()).toEqual([false, true]);
      await expect(listInvoices(tx, crew, {})).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  it("warns on drafts: no email, first month, late fee, billed to the agency", async () => {
    await withRollback(async (tx) => {
      const agency = await makeBillingCustomer(tx, { email: null });
      const complex = await makeBillingCustomer(tx, { managedById: agency.customerId });
      const earlier = await makeIssuedInvoice(tx, {
        customerId: complex.customerId,
        billToCustomerId: agency.customerId,
        dueDate: "2026-01-31",
        kind: "MONTHLY",
        serviceMonth: "2099-01",
      });
      const second = await tx.invoice.create({
        data: {
          customerId: complex.customerId,
          billToCustomerId: complex.customerId,
          kind: "MONTHLY",
          serviceMonth: fromDateString("2099-02-01"),
          dueDate: fromDateString("2099-01-31"),
          lines: {
            create: [
              { sortOrder: 1, kind: "SERVICE", description: "Garden", amountCents: 1000 },
              {
                sortOrder: 2,
                kind: "LATE_FEE",
                description: "Late payment fee",
                amountCents: 10000,
                forInvoiceId: earlier,
              },
            ],
          },
        },
        select: { id: true },
      });
      const own = await makeBillingCustomer(tx);
      const first = await tx.invoice.create({
        data: {
          customerId: own.customerId,
          billToCustomerId: own.customerId,
          kind: "MONTHLY",
          serviceMonth: fromDateString("2099-02-01"),
          dueDate: fromDateString("2099-01-31"),
          lines: {
            create: [{ sortOrder: 1, kind: "SERVICE", description: "Garden", amountCents: 1000 }],
          },
        },
        select: { id: true },
      });
      const drafts = await listDraftsForReview(tx, manager);
      const a = drafts.find((d) => d.id === second.id);
      const b = drafts.find((d) => d.id === first.id);
      // the draft was stored as billed to the complex, but the complex's bills go to the agency now
      expect(a?.billTo.id).toBe(agency.customerId);
      expect(a?.warnings.sort()).toEqual(["billToAgency", "lateFee", "noEmail"]);
      expect(a?.totalCents).toBe(11000);
      expect(b?.warnings).toEqual(["firstMonth"]);
      // the invoice page shows the same current bill-to for the draft
      expect((await getInvoice(tx, manager, second.id))?.billTo.id).toBe(agency.customerId);
    });
  });
});

describe.skipIf(!dbTestsEnabled)("reading an invoice that is not there", () => {
  it("returns null for an unknown id and refuses crew", async () => {
    await withRollback(async (tx) => {
      const unknown = "11111111-1111-4111-8111-111111111111";
      expect(await getInvoice(tx, manager, unknown)).toBeNull();
      expect(await getInvoice(tx, manager, "not-an-id")).toBeNull();
      await expect(getInvoice(tx, crew, unknown)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(deleteInvoiceDraft(tx, manager, unknown)).rejects.toBeInstanceOf(DomainError);
      await expect(deleteInvoiceDraft(tx, manager, "not-an-id")).rejects.toThrow(
        "That invoice could not be found.",
      );
    });
  });
});
