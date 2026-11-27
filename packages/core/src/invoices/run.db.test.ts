import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../customers/access";
import { toDateString } from "../quotes/reference";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { createMonthlyDrafts } from "./run";
import {
  addProperty,
  auditFor,
  crew,
  makeAcceptedQuote,
  makeBillingCustomer,
  makeIssuedInvoice,
  makePayment,
  manager,
  optionalLine,
  sameTx,
  serviceLine,
} from "./test-helpers";

const TODAY = "2026-11-20";

async function linesOf(tx: Parameters<Parameters<typeof withRollback>[0]>[0], invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: {
      kind: true,
      status: true,
      serviceMonth: true,
      dueDate: true,
      billToCustomerId: true,
      createdById: true,
      lines: {
        orderBy: { sortOrder: "asc" },
        select: {
          kind: true,
          description: true,
          amountCents: true,
          forInvoiceId: true,
          propertyId: true,
        },
      },
    },
  });
  return {
    ...inv,
    serviceMonth: inv.serviceMonth ? toDateString(inv.serviceMonth) : null,
    dueDate: inv.dueDate ? toDateString(inv.dueDate) : null,
  };
}

describe.skipIf(!dbTestsEnabled)("the monthly run", () => {
  it("drafts Pre and Post clients with the right month and due date, and is idempotent", async () => {
    await withRollback(async (tx) => {
      const pre = await makeBillingCustomer(tx, { billingTiming: "PRE" });
      const post = await makeBillingCustomer(tx, { billingTiming: "POST" });
      for (const c of [pre, post]) {
        await makeAcceptedQuote(tx, {
          customerId: c.customerId,
          propertyId: c.propertyId,
          startDate: "2026-10-01",
          lines: [
            serviceLine(115000),
            optionalLine(10000, true),
            optionalLine(20000, false, "Not chosen"),
          ],
        });
      }
      const only = [pre.customerId, post.customerId];
      await expect(
        createMonthlyDrafts(tx, crew, "2026-11", { run: sameTx(tx), only, today: TODAY }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const result = await createMonthlyDrafts(tx, manager, "2026-11", {
        run: sameTx(tx),
        only,
        today: TODAY,
      });
      expect(result.created).toHaveLength(2);
      expect(result.skipped).toEqual([]);

      const byCustomer = new Map(result.created.map((c) => [c.customerId, c.invoiceId]));
      const preInv = await linesOf(tx, byCustomer.get(pre.customerId) ?? "");
      expect(preInv).toMatchObject({
        kind: "MONTHLY",
        status: "DRAFT",
        serviceMonth: "2026-12-01",
        dueDate: "2026-11-30",
        billToCustomerId: pre.customerId,
        createdById: manager.id,
      });
      expect(preInv.lines.map((l) => [l.kind, l.description, l.amountCents])).toEqual([
        ["SERVICE", `${pre.propertyLabel}: Weekly garden maintenance`, 115000],
        ["OPTIONAL", `${pre.propertyLabel}: Weed treatment`, 10000],
      ]);
      const postInv = await linesOf(tx, byCustomer.get(post.customerId) ?? "");
      expect(postInv).toMatchObject({ serviceMonth: "2026-11-01", dueDate: "2026-11-25" });

      const audit = await auditFor(tx, "invoice", byCustomer.get(pre.customerId) ?? "");
      expect(audit.map((a) => a.action)).toEqual(["invoice.drafted"]);
      expect(audit[0]?.after).toEqual({ kind: "MONTHLY", via: "run", lineCount: 2, lateFees: 0 });

      const again = await createMonthlyDrafts(tx, manager, "2026-11", {
        run: sameTx(tx),
        only,
        today: TODAY,
      });
      expect(again.created).toEqual([]);
      expect(again.skipped.map((s) => s.reason)).toEqual(["alreadyInvoiced", "alreadyInvoiced"]);
    });
  });

  it("skips leads, paused, archived and anonymised customers and agreements that start later", async () => {
    await withRollback(async (tx) => {
      const lead = await makeBillingCustomer(tx, { status: "LEAD" });
      const paused = await makeBillingCustomer(tx, { status: "PAUSED" });
      const archived = await makeBillingCustomer(tx, { status: "ARCHIVED" });
      const gone = await makeBillingCustomer(tx);
      const later = await makeBillingCustomer(tx, { billingTiming: "POST" });
      const ended = await makeBillingCustomer(tx);
      for (const c of [lead, paused, archived, gone]) {
        await makeAcceptedQuote(tx, {
          customerId: c.customerId,
          propertyId: c.propertyId,
          startDate: "2026-10-01",
          lines: [serviceLine(50000)],
        });
      }
      await tx.customer.update({
        where: { id: gone.customerId },
        data: { anonymisedAt: new Date() },
        select: { id: true },
      });
      // Post in November bills November: a December start is not started yet.
      await makeAcceptedQuote(tx, {
        customerId: later.customerId,
        propertyId: later.propertyId,
        startDate: "2026-12-01",
        lines: [serviceLine(50000)],
      });
      // An agreement that a later quote replaced is not a candidate at all.
      await makeAcceptedQuote(tx, {
        customerId: ended.customerId,
        propertyId: ended.propertyId,
        startDate: "2026-10-01",
        lines: [serviceLine(50000)],
        agreementEnded: true,
      });
      const only = [lead, paused, archived, gone, later, ended].map((c) => c.customerId);
      const result = await createMonthlyDrafts(tx, manager, "2026-11", {
        run: sameTx(tx),
        only,
        today: TODAY,
      });
      expect(result.created).toEqual([]);
      const reasons = new Map(result.skipped.map((s) => [s.customerId, s.reason]));
      expect(reasons.get(lead.customerId)).toBe("lead");
      expect(reasons.get(paused.customerId)).toBe("paused");
      expect(reasons.get(archived.customerId)).toBe("archived");
      expect(reasons.get(gone.customerId)).toBe("anonymised");
      expect(reasons.get(later.customerId)).toBe("notStarted");
      expect(reasons.has(ended.customerId)).toBe(false);
      expect(result.skipped).toHaveLength(5);
    });
  });

  it("bills a complex's invoice to its agency, with a line per property and a part first month", async () => {
    await withRollback(async (tx) => {
      const agency = await makeBillingCustomer(tx);
      const complex = await makeBillingCustomer(tx, {
        managedById: agency.customerId,
        billingTiming: "PRE",
      });
      const second = await addProperty(tx, complex.customerId, "ZZZ Second site");
      await makeAcceptedQuote(tx, {
        customerId: complex.customerId,
        propertyId: complex.propertyId,
        startDate: "2026-10-01",
        lines: [serviceLine(100000)],
      });
      // Starts on 10 December: 22 of 31 days of R1,150.00 = R816.13
      await makeAcceptedQuote(tx, {
        customerId: complex.customerId,
        propertyId: second,
        startDate: "2026-12-10",
        lines: [serviceLine(115000, "Fortnightly garden care")],
      });
      const result = await createMonthlyDrafts(tx, manager, "2026-11", {
        run: sameTx(tx),
        only: [complex.customerId],
        today: TODAY,
      });
      const inv = await linesOf(tx, result.created[0]?.invoiceId ?? "");
      expect(inv.billToCustomerId).toBe(agency.customerId);
      expect(inv.lines.map((l) => [l.description, l.amountCents, l.propertyId])).toEqual([
        [`${complex.propertyLabel}: Weekly garden maintenance`, 100000, complex.propertyId],
        [
          "ZZZ Second site: Fortnightly garden care (part month: 22 of 31 days from 10 Dec)",
          81613,
          second,
        ],
      ]);
    });
  });

  it("suggests one late fee per overdue invoice, once only, and again after that fee's invoice is voided", async () => {
    await withRollback(async (tx) => {
      // The dev settings row may have been edited by hand: pin the fee for this test (rolled back).
      await tx.invoiceSettings.update({
        where: { id: "singleton" },
        data: { lateFeeCents: 10000 },
        select: { id: true },
      });
      const c = await makeBillingCustomer(tx, { billingTiming: "POST" });
      await makeAcceptedQuote(tx, {
        customerId: c.customerId,
        propertyId: c.propertyId,
        startDate: "2026-01-01",
        lines: [serviceLine(50000)],
      });
      const overdue = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        dueDate: "2026-10-25",
      });
      const paidUp = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        dueDate: "2026-10-25",
        totalCents: 30000,
      });
      await makePayment(tx, {
        payerCustomerId: c.customerId,
        amountCents: 30000,
        receivedOn: "2026-10-20",
        allocations: [{ invoiceId: paidUp, amountCents: 30000 }],
      });
      await makeIssuedInvoice(tx, { customerId: c.customerId, dueDate: "2026-12-25" });

      const run = { run: sameTx(tx), only: [c.customerId], today: TODAY };
      const first = await createMonthlyDrafts(tx, manager, "2026-11", run);
      const draftId = first.created[0]?.invoiceId ?? "";
      const lines = (await linesOf(tx, draftId)).lines;
      const fees = lines.filter((l) => l.kind === "LATE_FEE");
      expect(fees).toHaveLength(1);
      expect(fees[0]).toMatchObject({ amountCents: 10000, forInvoiceId: overdue });
      expect(fees[0]?.description).toMatch(/^Late payment fee: INV-2099-\d{4,}$/);
      expect((await auditFor(tx, "invoice", draftId))[0]?.after).toEqual({
        kind: "MONTHLY",
        via: "run",
        lineCount: 2,
        lateFees: 1,
      });

      // The fee is on a live draft: December's run does not suggest it again.
      const december = await createMonthlyDrafts(tx, manager, "2026-12", {
        ...run,
        today: "2026-12-20",
      });
      const decLines = (await linesOf(tx, december.created[0]?.invoiceId ?? "")).lines;
      expect(decLines.filter((l) => l.kind === "LATE_FEE")).toEqual([]);

      // Voiding the November invoice that carried the fee makes it suggestible again.
      await tx.invoice.update({
        where: { id: draftId },
        data: {
          status: "VOID",
          numberYear: 2099,
          numberSeq: 1_999_999_999,
          dueDate: new Date("2026-11-25T00:00:00Z"),
          issuedAt: new Date(),
          totalCents: 60000,
          voidedAt: new Date(),
        },
        select: { id: true },
      });
      const novemberAgain = await createMonthlyDrafts(tx, manager, "2026-11", run);
      const againLines = (await linesOf(tx, novemberAgain.created[0]?.invoiceId ?? "")).lines;
      expect(againLines.filter((l) => l.kind === "LATE_FEE").map((l) => l.forInvoiceId)).toEqual([
        overdue,
      ]);
    });
  });

  it("keeps going when one customer fails, and refuses a month too far ahead", async () => {
    await withRollback(async (tx) => {
      const a = await makeBillingCustomer(tx);
      const b = await makeBillingCustomer(tx);
      for (const c of [a, b]) {
        await makeAcceptedQuote(tx, {
          customerId: c.customerId,
          propertyId: c.propertyId,
          startDate: "2026-10-01",
          lines: [serviceLine(50000)],
        });
      }
      let calls = 0;
      const flaky = <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("boom"));
        return fn(tx);
      };
      const result = await createMonthlyDrafts(tx, manager, "2026-11", {
        run: flaky,
        only: [a.customerId, b.customerId],
        today: TODAY,
      });
      expect(result.created).toHaveLength(1);
      expect(result.skipped.map((s) => s.reason)).toEqual(["failed"]);
      await expect(
        createMonthlyDrafts(tx, manager, "2027-01", {
          run: sameTx(tx),
          only: [a.customerId],
          today: TODAY,
        }),
      ).rejects.toThrow("Choose a month from a year ago up to next month.");
    });
  });

  it("counts a refusal by the once-a-month index as already invoiced, and stops on a ForbiddenError", async () => {
    await withRollback(async (tx) => {
      const a = await makeBillingCustomer(tx);
      await makeAcceptedQuote(tx, {
        customerId: a.customerId,
        propertyId: a.propertyId,
        startDate: "2026-10-01",
        lines: [serviceLine(50000)],
      });
      const only = [a.customerId];
      // The shape a concurrent run's winner causes: the transaction rolled back with the unique index named.
      const duplicate = () =>
        Promise.reject(
          Object.assign(
            new Error(
              "Unique constraint failed on the constraint: `invoices_monthly_once_per_month`",
            ),
            {
              code: "P2002",
            },
          ),
        );
      const result = await createMonthlyDrafts(tx, manager, "2026-11", {
        run: duplicate,
        only,
        today: TODAY,
      });
      expect(result).toMatchObject({ runMonth: "2026-11", created: [] });
      expect(result.skipped).toEqual([
        { customerId: a.customerId, displayName: a.displayName, reason: "alreadyInvoiced" },
      ]);
      // Any other unique refusal (an invoice number, say) is a failure, not a duplicate.
      const other = () =>
        Promise.reject(
          Object.assign(new Error("invoices_numberYear_numberSeq_key"), { code: "P2002" }),
        );
      const failed = await createMonthlyDrafts(tx, manager, "2026-11", {
        run: other,
        only,
        today: TODAY,
      });
      expect(failed.skipped.map((s) => s.reason)).toEqual(["failed"]);
      const forbidden = () => Promise.reject(new ForbiddenError());
      await expect(
        createMonthlyDrafts(tx, manager, "2026-11", { run: forbidden, only, today: TODAY }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
