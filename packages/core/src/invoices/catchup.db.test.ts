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
  type TestQuoteLine,
} from "./test-helpers";

/** After the November run on the 20th. */
const TODAY = "2026-11-25";

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];

/** 10:00 in South Africa on that day. */
const at = (date: string, time = "10:00") => new Date(`${date}T${time}:00+02:00`);

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

/** [service month, line amounts] of each monthly invoice. */
const amountsOf = async (tx: Tx, customerId: string) =>
  (await monthlyOf(tx, customerId)).map((i) => [
    i.serviceMonth?.slice(0, 7),
    i.lines.map((l) => l.amountCents),
  ]);

/** A client with one agreement on its property, accepted on `accepted` (a South African date). */
async function client(
  tx: Tx,
  opts: {
    timing: "PRE" | "POST";
    start: string | null;
    accepted: string;
    acceptedTime?: string;
    status?: "LEAD" | "ACTIVE" | "PAUSED" | "ARCHIVED";
    managedById?: string;
    lines?: TestQuoteLine[];
  },
) {
  const c = await makeBillingCustomer(tx, {
    billingTiming: opts.timing,
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.managedById ? { managedById: opts.managedById } : {}),
  });
  const quote = await makeAcceptedQuote(tx, {
    customerId: c.customerId,
    propertyId: c.propertyId,
    startDate: opts.start,
    acceptedAt: at(opts.accepted, opts.acceptedTime),
    lines: opts.lines ?? [serviceLine(120000)],
  });
  return { ...c, quoteId: quote.quoteId };
}

const mine = async (tx: Tx, ids: string[], today = TODAY) =>
  (await listStartMonthCandidates(tx, manager, today)).filter((r) => ids.includes(r.customerId));

const catchUp = (tx: Tx, only: string[], today = TODAY) =>
  createStartMonthDrafts(tx, manager, { run: sameTx(tx), only, today });

describe.skipIf(!dbTestsEnabled)("start-month catch-up", () => {
  it("gives a Pre client accepted after the run the November part month AND December, once only", async () => {
    await withRollback(async (tx) => {
      const c = await client(tx, {
        timing: "PRE",
        start: "2026-11-27",
        accepted: TODAY,
        lines: [
          serviceLine(120000),
          optionalLine(30000, true),
          optionalLine(20000, false, "Not chosen"),
        ],
      });
      const only = [c.customerId];

      // November: 27 to 30 Nov, 4 of 30 days. December: the whole month (nobody else bills it: the run
      // on 20 Nov came before the acceptance, the run on 20 Dec bills January).
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
        {
          customerId: c.customerId,
          customerNumber: c.number,
          customerName: c.displayName,
          propertyLabel: c.propertyLabel,
          firstServiceOn: "2026-11-27",
          serviceMonth: "2026-12",
          amountPreviewCents: 150000,
        },
      ]);
      // Reading the list writes nothing.
      expect(await monthlyOf(tx, c.customerId)).toEqual([]);

      const result = await catchUp(tx, only);
      expect(result.created.map((r) => r.serviceMonth)).toEqual(["2026-11", "2026-12"]);
      expect(result).toMatchObject({ skipped: 0, failed: 0 });
      const [nov, dec] = await monthlyOf(tx, c.customerId);
      expect(nov).toMatchObject({
        status: "DRAFT",
        serviceMonth: "2026-11-01",
        // The normal due date (31 Oct) has passed: a week from today.
        dueDate: "2026-12-02",
        billToCustomerId: c.customerId,
        createdById: manager.id,
      });
      expect(nov?.lines.map((l) => [l.kind, l.description, l.amountCents])).toEqual([
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
      // December: normal due date 30 Nov, a week from today is later.
      expect(dec).toMatchObject({
        status: "DRAFT",
        serviceMonth: "2026-12-01",
        dueDate: "2026-12-02",
      });
      expect(dec?.lines.map((l) => [l.description, l.amountCents])).toEqual([
        [`${c.propertyLabel}: Weekly garden maintenance`, 120000],
        [`${c.propertyLabel}: Weed treatment`, 30000],
      ]);
      for (const inv of [nov, dec]) {
        const audit = await auditFor(tx, "invoice", inv?.id ?? "");
        expect(audit.map((a) => [a.action, a.after])).toEqual([
          ["invoice.drafted", { kind: "MONTHLY", via: "catchup", lineCount: 2 }],
        ]);
      }

      // Twice: nothing more, and the list is empty.
      expect(await catchUp(tx, only)).toEqual({ created: [], skipped: 1, failed: 0 });
      expect(await mine(tx, only)).toEqual([]);
      // The November run (Pre: December) pressed again skips the customer as already invoiced.
      const run = await createMonthlyDrafts(tx, manager, "2026-11", {
        run: sameTx(tx),
        only,
        today: TODAY,
      });
      expect(run.skipped.map((s) => s.reason)).toEqual(["alreadyInvoiced"]);
      // January is the December run's (20 Dec): never a catch-up, not even on the 20th.
      for (const today of ["2026-12-05", "2026-12-20"]) {
        expect((await catchUp(tx, only, today)).created).toEqual([]);
      }
      expect(await amountsOf(tx, c.customerId)).toEqual([
        ["2026-11", [16000, 4000]],
        ["2026-12", [120000, 30000]],
      ]);
    });
  });

  it("leaves to the run a Pre client accepted before the 20th and a Post client accepted before the 20th", async () => {
    await withRollback(async (tx) => {
      // Pre, accepted 10 Nov, starting 3 Dec: the run on 20 Nov bills December.
      const pre = await client(tx, { timing: "PRE", start: "2026-12-03", accepted: "2026-11-10" });
      // Post, accepted 18 Nov: the November run is due on the 20th; it has not been pressed yet.
      const post = await client(tx, {
        timing: "POST",
        start: "2026-11-19",
        accepted: "2026-11-18",
      });
      const only = [pre.customerId, post.customerId];
      expect(await mine(tx, only, "2026-11-10")).toEqual([]);
      expect(await mine(tx, only)).toEqual([]);
      expect((await catchUp(tx, only)).created).toEqual([]);
      expect(await monthlyOf(tx, pre.customerId)).toEqual([]);
      expect(await monthlyOf(tx, post.customerId)).toEqual([]);
      // The run on the 20th bills them (December 3 to 31: 29 of 31 days of R1,200.00 = R1,122.58).
      await createMonthlyDrafts(tx, manager, "2026-11", {
        run: sameTx(tx),
        only,
        today: "2026-11-20",
      });
      expect(await amountsOf(tx, pre.customerId)).toEqual([["2026-12", [112258]]]);
      expect((await amountsOf(tx, post.customerId)).map((r) => r[0])).toEqual(["2026-11"]);
      expect((await catchUp(tx, only)).created).toEqual([]);
    });
  });

  it("counts an acceptance on the 20th itself (South African date) but not the evening before", async () => {
    await withRollback(async (tx) => {
      // 00:30 on 20 Nov in South Africa is still 19 Nov in UTC.
      const onThe20th = await client(tx, {
        timing: "POST",
        start: "2026-11-21",
        accepted: "2026-11-20",
        acceptedTime: "00:30",
      });
      const before = await client(tx, {
        timing: "POST",
        start: "2026-11-21",
        accepted: "2026-11-19",
        acceptedTime: "23:30",
      });
      const only = [onThe20th.customerId, before.customerId];
      expect((await mine(tx, only, "2026-11-20")).map((r) => r.customerId)).toEqual([
        onThe20th.customerId,
      ]);
      const result = await catchUp(tx, only, "2026-11-20");
      expect(result.created.map((r) => [r.customerId, r.serviceMonth])).toEqual([
        [onThe20th.customerId, "2026-11"],
      ]);
      // 21 to 30 November: 10 of 30 days = R400.00.
      expect(await amountsOf(tx, onThe20th.customerId)).toEqual([["2026-11", [40000]]]);
    });
  });

  it("bills a Post client accepted after the run for its month in full, and a replacement at the new price", async () => {
    await withRollback(async (tx) => {
      // Accepted 22 Nov with a start on 1 Nov: the whole of November.
      const post = await client(tx, {
        timing: "POST",
        start: "2026-11-01",
        accepted: "2026-11-22",
      });
      // A replacement accepted after the November run, for a month with no invoice: the whole month at the
      // new price, never pro-rated.
      const replaced = await makeBillingCustomer(tx, { billingTiming: "POST" });
      const old = await makeAcceptedQuote(tx, {
        customerId: replaced.customerId,
        propertyId: replaced.propertyId,
        startDate: "2026-01-01",
        acceptedAt: at("2025-12-15"),
        lines: [serviceLine(100000, "Old rate")],
      });
      const replacement = await makeAcceptedQuote(tx, {
        customerId: replaced.customerId,
        propertyId: replaced.propertyId,
        startDate: "2026-11-27",
        acceptedAt: at("2026-11-22"),
        lines: [serviceLine(110000, "New rate")],
      });
      await replaceAgreement(tx, old.quoteId, replacement.quoteId);
      const only = [post.customerId, replaced.customerId];
      const result = await catchUp(tx, only);
      expect(result.created).toHaveLength(2);
      const [inv] = await monthlyOf(tx, post.customerId);
      // Normal due date 25 Nov has passed: a week from today.
      expect(inv).toMatchObject({ serviceMonth: "2026-11-01", dueDate: "2026-12-02" });
      expect(inv?.lines.map((l) => l.amountCents)).toEqual([120000]);
      const [rep] = await monthlyOf(tx, replaced.customerId);
      expect(rep?.lines.map((l) => [l.description, l.amountCents])).toEqual([
        [`${replaced.propertyLabel}: New rate`, 110000],
      ]);
    });
  });

  it("catches up last month (due today at the latest) and falls back to the acceptance date, never old history", async () => {
    await withRollback(async (tx) => {
      // Post, accepted 26 Oct after October's run, starting 27 Oct, never billed. November's run (20 Nov)
      // came after the acceptance, so November is the run's.
      const lastMonth = await client(tx, {
        timing: "POST",
        start: "2026-10-27",
        accepted: "2026-10-26",
      });
      // No start date: the acceptance date (24 Nov) is the first service.
      const fallback = await client(tx, { timing: "PRE", start: null, accepted: "2026-11-24" });
      // Accepted and started in August, never billed: too old for the catch-up.
      const history = await client(tx, {
        timing: "POST",
        start: "2026-08-10",
        accepted: "2026-08-09",
      });
      const only = [lastMonth.customerId, fallback.customerId, history.customerId];
      const rows = await mine(tx, only);
      expect(rows.map((r) => [r.customerId, r.serviceMonth, r.firstServiceOn])).toEqual(
        expect.arrayContaining([
          [lastMonth.customerId, "2026-10", "2026-10-27"],
          [fallback.customerId, "2026-11", "2026-11-24"],
          [fallback.customerId, "2026-12", "2026-11-24"],
        ]),
      );
      expect(rows).toHaveLength(3);

      expect((await catchUp(tx, only)).created).toHaveLength(3);
      const [oct] = await monthlyOf(tx, lastMonth.customerId);
      // 27 to 31 October: 5 of 31 days = R193.55. A week after October is past: due today.
      expect(oct).toMatchObject({ serviceMonth: "2026-10-01", dueDate: TODAY });
      expect(oct?.lines.map((l) => l.amountCents)).toEqual([19355]);
      // 24 to 30 November: 7 of 30 days = R280.00, then December in full.
      expect(await amountsOf(tx, fallback.customerId)).toEqual([
        ["2026-11", [28000]],
        ["2026-12", [120000]],
      ]);
      expect(await monthlyOf(tx, history.customerId)).toEqual([]);
    });
  });

  it("works across the year end: December's part month and January in full", async () => {
    await withRollback(async (tx) => {
      const c = await client(tx, { timing: "PRE", start: "2026-12-28", accepted: "2026-12-22" });
      const result = await catchUp(tx, [c.customerId], "2026-12-22");
      expect(result.created.map((r) => r.serviceMonth)).toEqual(["2026-12", "2027-01"]);
      const [dec, jan] = await monthlyOf(tx, c.customerId);
      // 28 to 31 December: 4 of 31 days = R154.84, due a week from today.
      expect(dec).toMatchObject({ serviceMonth: "2026-12-01", dueDate: "2026-12-29" });
      expect(dec?.lines.map((l) => l.amountCents)).toEqual([15484]);
      // January: the normal due date (31 Dec) is later than a week from today.
      expect(jan).toMatchObject({ serviceMonth: "2027-01-01", dueDate: "2026-12-31" });
      expect(jan?.lines.map((l) => l.amountCents)).toEqual([120000]);
      // The December run (Pre: January) pressed again skips it.
      const run = await createMonthlyDrafts(tx, manager, "2026-12", {
        run: sameTx(tx),
        only: [c.customerId],
        today: "2026-12-22",
      });
      expect(run.skipped.map((s) => s.reason)).toEqual(["alreadyInvoiced"]);
    });
  });

  it("leaves out leads, paused, archived and anonymised customers and archived properties", async () => {
    await withRollback(async (tx) => {
      const make = (status?: "LEAD" | "PAUSED" | "ARCHIVED") =>
        client(tx, {
          timing: "POST",
          start: "2026-11-27",
          accepted: TODAY,
          ...(status ? { status } : {}),
        });
      const lead = await make("LEAD");
      const paused = await make("PAUSED");
      const archived = await make("ARCHIVED");
      const gone = await make();
      await tx.customer.update({
        where: { id: gone.customerId },
        data: { anonymisedAt: new Date() },
        select: { id: true },
      });
      const shut = await make();
      await tx.property.update({
        where: { id: shut.propertyId },
        data: { archivedAt: new Date() },
        select: { id: true },
      });
      const only = [lead, paused, archived, gone, shut].map((c) => c.customerId);
      expect(await mine(tx, only)).toEqual([]);
      expect((await catchUp(tx, only)).created).toEqual([]);
      for (const id of only) expect(await monthlyOf(tx, id)).toEqual([]);
    });
  });

  it("is blocked by a live invoice for the month but not by a void one", async () => {
    await withRollback(async (tx) => {
      const make = () => client(tx, { timing: "POST", start: "2026-11-27", accepted: TODAY });
      const billed = await make();
      await makeIssuedInvoice(tx, {
        customerId: billed.customerId,
        dueDate: "2026-11-30",
        kind: "MONTHLY",
        serviceMonth: "2026-11",
      });
      const voided = await make();
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
      const result = await catchUp(tx, only);
      expect(result.created.map((c) => [c.customerId, c.serviceMonth])).toEqual([
        [voided.customerId, "2026-11"],
      ]);
      expect(result.skipped).toBe(1);
    });
  });

  it("bills a complex's catch-up to its agency, honours `only`, ignores bad ids and refuses crew", async () => {
    await withRollback(async (tx) => {
      const agency = await makeBillingCustomer(tx);
      const complex = await client(tx, {
        timing: "POST",
        start: "2026-11-23",
        accepted: "2026-11-21",
        managedById: agency.customerId,
      });
      const other = await client(tx, {
        timing: "POST",
        start: "2026-11-23",
        accepted: "2026-11-21",
      });

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

      const result = await catchUp(tx, ["not-a-uuid", "", complex.customerId.toUpperCase()]);
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
      expect(await monthlyOf(tx, other.customerId)).toEqual([]);
      expect(await catchUp(tx, ["nope"])).toEqual({ created: [], skipped: 0, failed: 0 });
    });
  });

  it("keeps going when one customer fails, logs fixed words only, and counts an index refusal as skipped", async () => {
    await withRollback(async (tx) => {
      const a = await client(tx, { timing: "POST", start: "2026-11-27", accepted: TODAY });
      const b = await client(tx, { timing: "POST", start: "2026-11-27", accepted: TODAY });
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
