import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../customers/access";
import { toDateString } from "../quotes/reference";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { createStartMonthDrafts, listStartMonthCandidates } from "./catchup";
import { createMonthlyDrafts } from "./run";
import {
  auditFor,
  crew,
  makeAcceptedQuote,
  makeBillingCustomer,
  makeIssuedInvoice,
  manager,
  optionalLine,
  replaceAgreement,
  sameTx,
  serviceLine,
} from "./test-helpers";

/** After the November run on the 20th: a Pre client accepting now was missed by it. */
const TODAY = "2026-11-25";

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];

async function monthlyOf(tx: Tx, customerId: string) {
  const rows = await tx.invoice.findMany({
    where: { customerId, kind: "MONTHLY" },
    orderBy: { serviceMonth: "asc" },
    select: {
      id: true,
      status: true,
      serviceMonth: true,
      dueDate: true,
      billToCustomerId: true,
      createdById: true,
      lines: {
        orderBy: { sortOrder: "asc" },
        select: { kind: true, description: true, amountCents: true, propertyId: true },
      },
    },
  });
  return rows.map((r) => ({
    ...r,
    serviceMonth: r.serviceMonth ? toDateString(r.serviceMonth) : null,
    dueDate: r.dueDate ? toDateString(r.dueDate) : null,
  }));
}

/** A client with one first agreement on its property. */
async function client(
  tx: Tx,
  opts: {
    timing: "PRE" | "POST";
    start: string;
    status?: "LEAD" | "ACTIVE" | "PAUSED" | "ARCHIVED";
    managedById?: string;
  },
) {
  const c = await makeBillingCustomer(tx, {
    billingTiming: opts.timing,
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.managedById ? { managedById: opts.managedById } : {}),
  });
  await makeAcceptedQuote(tx, {
    customerId: c.customerId,
    propertyId: c.propertyId,
    startDate: opts.start,
    lines: [serviceLine(120000)],
  });
  return c;
}

const mine = async (tx: Tx, ids: string[], today = TODAY) =>
  (await listStartMonthCandidates(tx, manager, today)).filter((r) => ids.includes(r.customerId));

describe.skipIf(!dbTestsEnabled)("start-month catch-up", () => {
  it("drafts a part month for a Pre client accepted after the run, once only, with no later duplicate", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx, { billingTiming: "PRE" });
      await makeAcceptedQuote(tx, {
        customerId: c.customerId,
        propertyId: c.propertyId,
        startDate: "2026-11-27",
        lines: [
          serviceLine(120000),
          optionalLine(30000, true),
          optionalLine(20000, false, "Not chosen"),
        ],
      });
      const only = [c.customerId];

      // 27 to 30 November: 4 of 30 days of R1,200.00 and of R300.00.
      expect(await mine(tx, only)).toEqual([
        {
          customerId: c.customerId,
          customerNumber: c.number,
          customerName: c.displayName,
          propertyLabel: c.propertyLabel,
          firstServiceOn: "2026-11-27",
          serviceMonth: "2026-11",
          amountPreviewCents: 16000 + 4000,
        },
      ]);
      // Reading the list writes nothing.
      expect(await monthlyOf(tx, c.customerId)).toEqual([]);

      const result = await createStartMonthDrafts(tx, manager, {
        run: sameTx(tx),
        only,
        today: TODAY,
      });
      expect(result.created).toHaveLength(1);
      expect(result).toMatchObject({ skipped: 0, failed: 0 });
      const [inv] = await monthlyOf(tx, c.customerId);
      expect(inv).toMatchObject({
        status: "DRAFT",
        serviceMonth: "2026-11-01",
        // The normal due date (31 Oct) has passed: a week from today.
        dueDate: "2026-12-02",
        billToCustomerId: c.customerId,
        createdById: manager.id,
      });
      expect(inv?.lines.map((l) => [l.kind, l.description, l.amountCents])).toEqual([
        [
          "SERVICE",
          `${c.propertyLabel}: Weekly garden maintenance (part month: 4 of 30 days from 27 Nov)`,
          16000,
        ],
        [
          "OPTIONAL",
          `${c.propertyLabel}: Weed treatment (part month: 4 of 30 days from 27 Nov)`,
          4000,
        ],
      ]);
      const audit = await auditFor(tx, "invoice", inv?.id ?? "");
      expect(audit.map((a) => [a.action, a.after])).toEqual([
        ["invoice.drafted", { kind: "MONTHLY", via: "catchup", lineCount: 2 }],
      ]);

      // Twice: nothing more, and the list is empty.
      const again = await createStartMonthDrafts(tx, manager, {
        run: sameTx(tx),
        only,
        today: TODAY,
      });
      expect(again).toEqual({ created: [], skipped: 1, failed: 0 });
      expect(await mine(tx, only)).toEqual([]);

      // The November run done again bills December in full; November is not billed a second time.
      await createMonthlyDrafts(tx, manager, "2026-11", { run: sameTx(tx), only, today: TODAY });
      const december = await createStartMonthDrafts(tx, manager, {
        run: sameTx(tx),
        only,
        today: "2026-12-05",
      });
      expect(december.created).toEqual([]);
      const all = await monthlyOf(tx, c.customerId);
      expect(all.map((i) => [i.serviceMonth, i.lines.map((l) => l.amountCents)])).toEqual([
        ["2026-11-01", [16000, 4000]],
        ["2026-12-01", [120000, 30000]],
      ]);
    });
  });

  it("drafts next month for a Pre client accepted after the run, in full from the 1st, and the run then skips it", async () => {
    await withRollback(async (tx) => {
      const c = await client(tx, { timing: "PRE", start: "2026-12-01" });
      const only = [c.customerId];
      expect(await mine(tx, only)).toEqual([
        {
          customerId: c.customerId,
          customerNumber: c.number,
          customerName: c.displayName,
          propertyLabel: c.propertyLabel,
          firstServiceOn: "2026-12-01",
          serviceMonth: "2026-12",
          amountPreviewCents: 120000,
        },
      ]);
      const result = await createStartMonthDrafts(tx, manager, {
        run: sameTx(tx),
        only,
        today: TODAY,
      });
      expect(result.created.map((r) => r.serviceMonth)).toEqual(["2026-12"]);
      const [dec] = await monthlyOf(tx, c.customerId);
      // Starts on the 1st: the whole month, no part month. Normal due 30 Nov, a week from today is later.
      expect(dec).toMatchObject({
        status: "DRAFT",
        serviceMonth: "2026-12-01",
        dueDate: "2026-12-02",
      });
      expect(dec?.lines.map((l) => [l.description, l.amountCents])).toEqual([
        [`${c.propertyLabel}: Weekly garden maintenance`, 120000],
      ]);
      // The November run (which bills Pre clients for December) pressed again: already invoiced.
      const run = await createMonthlyDrafts(tx, manager, "2026-11", {
        run: sameTx(tx),
        only,
        today: TODAY,
      });
      expect(run.created).toEqual([]);
      expect(run.skipped.map((s) => s.reason)).toEqual(["alreadyInvoiced"]);
      // And the catch-up a second time, or in December, adds nothing.
      for (const today of [TODAY, "2026-12-05"]) {
        expect(
          (await createStartMonthDrafts(tx, manager, { run: sameTx(tx), only, today })).created,
        ).toEqual([]);
      }
      expect((await monthlyOf(tx, c.customerId)).map((i) => i.serviceMonth)).toEqual([
        "2026-12-01",
      ]);
    });
  });

  it("leaves a Pre client accepted before the 20th with a start next month to the run", async () => {
    await withRollback(async (tx) => {
      const c = await client(tx, { timing: "PRE", start: "2026-12-03" });
      const only = [c.customerId];
      expect(await mine(tx, only, "2026-11-10")).toEqual([]);
      expect(
        (
          await createStartMonthDrafts(tx, manager, {
            run: sameTx(tx),
            only,
            today: "2026-11-10",
          })
        ).created,
      ).toEqual([]);
      // The run on the 20th bills December (3 to 31 December: 29 of 31 days of R1,200.00 = R1,122.58).
      await createMonthlyDrafts(tx, manager, "2026-11", {
        run: sameTx(tx),
        only,
        today: "2026-11-20",
      });
      expect(await mine(tx, only)).toEqual([]);
      expect(
        (await createStartMonthDrafts(tx, manager, { run: sameTx(tx), only, today: TODAY }))
          .created,
      ).toEqual([]);
      const all = await monthlyOf(tx, c.customerId);
      expect(all.map((i) => [i.serviceMonth, i.lines.map((l) => l.amountCents)])).toEqual([
        ["2026-12-01", [112258]],
      ]);
    });
  });

  it("leaves alone a Post client accepted before the run, a start next month, a replacement and old history", async () => {
    await withRollback(async (tx) => {
      // Post, starting 17 Nov, seen on the 15th: the run on the 20th bills November.
      const early = await client(tx, { timing: "POST", start: "2026-11-17" });
      // Post, starting next month: its run is on 20 December, not yet due.
      const nextMonth = await client(tx, { timing: "POST", start: "2026-12-01" });
      // A replacement agreement starting this month is billed in full by the run, never pro-rated.
      const replaced = await makeBillingCustomer(tx, { billingTiming: "POST" });
      const old = await makeAcceptedQuote(tx, {
        customerId: replaced.customerId,
        propertyId: replaced.propertyId,
        startDate: "2026-01-01",
        acceptedAt: new Date("2025-12-15T10:00:00Z"),
        lines: [serviceLine(100000)],
      });
      const replacement = await makeAcceptedQuote(tx, {
        customerId: replaced.customerId,
        propertyId: replaced.propertyId,
        startDate: "2026-11-27",
        lines: [serviceLine(110000)],
      });
      await replaceAgreement(tx, old.quoteId, replacement.quoteId);
      // Started three months ago and never billed: too old for the catch-up.
      const history = await client(tx, { timing: "POST", start: "2026-08-10" });

      const only = [early, nextMonth, replaced, history].map((c) => c.customerId);
      expect(await mine(tx, [early.customerId], "2026-11-15")).toEqual([]);
      const onThe15th = await createStartMonthDrafts(tx, manager, {
        run: sameTx(tx),
        only: [early.customerId],
        today: "2026-11-15",
      });
      expect(onThe15th.created).toEqual([]);
      // The run on the 20th bills it; the catch-up after that adds nothing.
      await createMonthlyDrafts(tx, manager, "2026-11", {
        run: sameTx(tx),
        only: [early.customerId],
        today: "2026-11-20",
      });

      expect(await mine(tx, only)).toEqual([]);
      const result = await createStartMonthDrafts(tx, manager, {
        run: sameTx(tx),
        only,
        today: TODAY,
      });
      expect(result.created).toEqual([]);
      expect(result.failed).toBe(0);
      expect(await monthlyOf(tx, nextMonth.customerId)).toEqual([]);
      expect(await monthlyOf(tx, replaced.customerId)).toEqual([]);
      expect(await monthlyOf(tx, history.customerId)).toEqual([]);
      expect((await monthlyOf(tx, early.customerId)).map((i) => i.serviceMonth)).toEqual([
        "2026-11-01",
      ]);
    });
  });

  it("still catches up last month, due today at the latest, and falls back to the acceptance date", async () => {
    await withRollback(async (tx) => {
      // Post, started 27 Oct, after October's run, and never billed: still caught up in November.
      const lastMonth = await client(tx, { timing: "POST", start: "2026-10-27" });
      // No start date: the acceptance date (24 Nov in South Africa) is the first service.
      const fallback = await makeBillingCustomer(tx, { billingTiming: "PRE" });
      await makeAcceptedQuote(tx, {
        customerId: fallback.customerId,
        propertyId: fallback.propertyId,
        startDate: null,
        acceptedAt: new Date("2026-11-24T10:00:00Z"),
        lines: [serviceLine(120000)],
      });
      const only = [lastMonth.customerId, fallback.customerId];
      const rows = await mine(tx, only);
      expect(rows.map((r) => [r.customerId, r.serviceMonth, r.firstServiceOn])).toEqual(
        expect.arrayContaining([
          [lastMonth.customerId, "2026-10", "2026-10-27"],
          [fallback.customerId, "2026-11", "2026-11-24"],
        ]),
      );
      expect(rows).toHaveLength(2);

      const result = await createStartMonthDrafts(tx, manager, {
        run: sameTx(tx),
        only,
        today: TODAY,
      });
      expect(result.created).toHaveLength(2);
      const [oct] = await monthlyOf(tx, lastMonth.customerId);
      // 27 to 31 October: 5 of 31 days of R1,200.00 = R193.55. A week after October is past: due today.
      expect(oct).toMatchObject({ serviceMonth: "2026-10-01", dueDate: TODAY });
      expect(oct?.lines.map((l) => l.amountCents)).toEqual([19355]);
      const [nov] = await monthlyOf(tx, fallback.customerId);
      // 24 to 30 November: 7 of 30 days = R280.00.
      expect(nov?.lines.map((l) => l.amountCents)).toEqual([28000]);
    });
  });

  it("leaves out leads, paused, archived and anonymised customers and archived properties", async () => {
    await withRollback(async (tx) => {
      const lead = await client(tx, { timing: "PRE", start: "2026-11-27", status: "LEAD" });
      const paused = await client(tx, { timing: "PRE", start: "2026-11-27", status: "PAUSED" });
      const archived = await client(tx, { timing: "PRE", start: "2026-11-27", status: "ARCHIVED" });
      const gone = await client(tx, { timing: "PRE", start: "2026-11-27" });
      await tx.customer.update({
        where: { id: gone.customerId },
        data: { anonymisedAt: new Date() },
        select: { id: true },
      });
      const shut = await client(tx, { timing: "PRE", start: "2026-11-27" });
      await tx.property.update({
        where: { id: shut.propertyId },
        data: { archivedAt: new Date() },
        select: { id: true },
      });
      const only = [lead, paused, archived, gone, shut].map((c) => c.customerId);
      expect(await mine(tx, only)).toEqual([]);
      const result = await createStartMonthDrafts(tx, manager, {
        run: sameTx(tx),
        only,
        today: TODAY,
      });
      expect(result.created).toEqual([]);
      for (const id of only) expect(await monthlyOf(tx, id)).toEqual([]);
    });
  });

  it("is blocked by a live invoice for the month but not by a void one", async () => {
    await withRollback(async (tx) => {
      const billed = await client(tx, { timing: "PRE", start: "2026-11-27" });
      await makeIssuedInvoice(tx, {
        customerId: billed.customerId,
        dueDate: "2026-11-30",
        kind: "MONTHLY",
        serviceMonth: "2026-11",
      });
      const voided = await client(tx, { timing: "PRE", start: "2026-11-27" });
      const voidId = await makeIssuedInvoice(tx, {
        customerId: voided.customerId,
        dueDate: "2026-11-30",
        kind: "MONTHLY",
        serviceMonth: "2026-11",
      });
      await tx.invoice.update({
        where: { id: voidId },
        data: { status: "VOID", voidedAt: new Date() },
        select: { id: true },
      });
      const only = [billed.customerId, voided.customerId];
      expect((await mine(tx, only)).map((r) => r.customerId)).toEqual([voided.customerId]);
      const result = await createStartMonthDrafts(tx, manager, {
        run: sameTx(tx),
        only,
        today: TODAY,
      });
      expect(result.created.map((c) => c.customerId)).toEqual([voided.customerId]);
      expect(result.created[0]?.serviceMonth).toBe("2026-11");
      expect(result.skipped).toBe(1);
    });
  });

  it("bills a complex's catch-up to its agency, honours `only`, ignores bad ids and refuses crew", async () => {
    await withRollback(async (tx) => {
      const agency = await makeBillingCustomer(tx);
      const complex = await client(tx, {
        timing: "POST",
        start: "2026-11-23",
        managedById: agency.customerId,
      });
      const other = await client(tx, { timing: "POST", start: "2026-11-23" });

      await expect(listStartMonthCandidates(tx, crew, TODAY)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        createStartMonthDrafts(tx, crew, {
          run: sameTx(tx),
          only: [complex.customerId],
          today: TODAY,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);

      const result = await createStartMonthDrafts(tx, manager, {
        run: sameTx(tx),
        only: ["not-a-uuid", "", complex.customerId.toUpperCase()],
        today: TODAY,
      });
      expect(result.created.map((c) => c.customerId)).toEqual([complex.customerId]);
      const [inv] = await monthlyOf(tx, complex.customerId);
      // Post November, 25 Nov: a week from today (2 Dec), within a week of the month end (7 Dec).
      expect(inv).toMatchObject({
        billToCustomerId: agency.customerId,
        serviceMonth: "2026-11-01",
        dueDate: "2026-12-02",
      });
      // 23 to 30 November: 8 of 30 days of R1,200.00 = R320.00.
      expect(inv?.lines.map((l) => l.amountCents)).toEqual([32000]);
      // Not in `only`: untouched.
      expect(await monthlyOf(tx, other.customerId)).toEqual([]);
      // Only ids that are not ids: nothing at all.
      expect(
        await createStartMonthDrafts(tx, manager, {
          run: sameTx(tx),
          only: ["nope"],
          today: TODAY,
        }),
      ).toEqual({ created: [], skipped: 0, failed: 0 });
    });
  });

  it("keeps going when one customer fails, logs fixed words only, and counts an index refusal as skipped", async () => {
    await withRollback(async (tx) => {
      const a = await client(tx, { timing: "PRE", start: "2026-11-27" });
      const b = await client(tx, { timing: "PRE", start: "2026-11-27" });
      const only = [a.customerId, b.customerId];
      const logged: string[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => logged.push(args.map(String).join(" "));
      try {
        let calls = 0;
        const flaky = <T>(fn: (t: Tx) => Promise<T>): Promise<T> => {
          calls += 1;
          if (calls === 1) return Promise.reject(new Error(`boom ${a.displayName}`));
          return fn(tx);
        };
        const result = await createStartMonthDrafts(tx, manager, {
          run: flaky,
          only,
          today: TODAY,
        });
        expect(result.created).toHaveLength(1);
        expect(result.failed).toBe(1);
        expect(logged).toEqual(["A part-month invoice draft could not be created."]);

        const duplicate = () =>
          Promise.reject(
            Object.assign(
              new Error(
                "Unique constraint failed on the constraint: `invoices_monthly_once_per_month`",
              ),
              { code: "P2002" },
            ),
          );
        expect(
          await createStartMonthDrafts(tx, manager, { run: duplicate, only, today: TODAY }),
        ).toEqual({ created: [], skipped: 2, failed: 0 });
        const forbidden = () => Promise.reject(new ForbiddenError());
        await expect(
          createStartMonthDrafts(tx, manager, { run: forbidden, only, today: TODAY }),
        ).rejects.toBeInstanceOf(ForbiddenError);
      } finally {
        console.error = original;
      }
    });
  });
});
