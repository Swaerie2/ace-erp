import { describe, expect, it } from "vitest";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { makeCustomer } from "./test-helpers";

const TABLES = ["quote_wording", "quotes", "quote_scope_items", "quote_lines", "quote_counters"];
const validUntil = new Date("2099-01-01");

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];

/** A customer with a property, made inside the transaction so the foreign keys are satisfied. */
async function parents(tx: Tx) {
  const c = await makeCustomer(tx);
  return { customerId: c.customerId, propertyId: c.propertyId };
}

describe.skipIf(!dbTestsEnabled)("quote database protections", () => {
  it("has row level security on for every quote table", async () => {
    await withRollback(async (tx) => {
      const rls = await tx.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
        select relname, relrowsecurity from pg_class
        where relname in ('quote_wording', 'quotes', 'quote_scope_items', 'quote_lines', 'quote_counters')`;
      expect(rls.map((r) => r.relname).sort()).toEqual([...TABLES].sort());
      for (const row of rls) expect(row.relrowsecurity, row.relname).toBe(true);
    });
  });

  it("gives the public roles no direct read access to the quote tables", async () => {
    await withRollback(async (tx) => {
      for (const role of ["anon", "authenticated"]) {
        for (const table of TABLES) {
          const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`
            select has_table_privilege(${role}, ${table}, 'select') as allowed`;
          expect(row?.allowed, `${role} select on ${table}`).toBe(false);
        }
      }
    });
  });

  it("blocks the public API from reading quotes", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(url && key).toBeTruthy();
    const res = await fetch(`${url}/rest/v1/quotes?select=*`, {
      headers: { apikey: key!, Authorization: `Bearer ${key}` },
    });
    expect([401, 403]).toContain(res.status);
  });

  it("rejects a draft that has a number", async () => {
    await expect(
      withRollback(async (tx) => {
        const p = await parents(tx);
        await tx.quote.create({ data: { ...p, validUntil, numberYear: 2097, numberSeq: 1 } });
      }),
    ).rejects.toThrow(/quotes_number_iff_issued/);
  });

  it("rejects an issued quote that has no number", async () => {
    await expect(
      withRollback(async (tx) => {
        const p = await parents(tx);
        await tx.quote.create({ data: { ...p, validUntil, status: "ISSUED" } });
      }),
    ).rejects.toThrow(/quotes_number_iff_issued/);
  });

  it("rejects a number with only one half", async () => {
    await expect(
      withRollback(async (tx) => {
        const p = await parents(tx);
        await tx.quote.create({ data: { ...p, validUntil, status: "ISSUED", numberYear: 2097 } });
      }),
    ).rejects.toThrow(/quotes_number_pair/);
  });

  it("rejects a revision number below 1", async () => {
    await expect(
      withRollback(async (tx) => {
        const p = await parents(tx);
        await tx.quote.create({ data: { ...p, validUntil, revision: 0 } });
      }),
    ).rejects.toThrow(/quotes_revision_positive/);
  });

  it("rejects a price line of zero", async () => {
    await expect(
      withRollback(async (tx) => {
        const p = await parents(tx);
        const quote = await tx.quote.create({ data: { ...p, validUntil } });
        await tx.quoteLine.create({
          data: {
            quoteId: quote.id,
            sortOrder: 1,
            lineKind: "PRICED",
            billing: "ONCE_OFF",
            description: "Zero",
            amountCents: 0,
          },
        });
      }),
    ).rejects.toThrow(/quote_lines_amount_positive/);
  });

  it("rejects an included line that has an amount", async () => {
    await expect(
      withRollback(async (tx) => {
        const p = await parents(tx);
        const quote = await tx.quote.create({ data: { ...p, validUntil } });
        await tx.quoteLine.create({
          data: {
            quoteId: quote.id,
            sortOrder: 1,
            lineKind: "INCLUDED",
            description: "Free",
            amountCents: 500,
          },
        });
      }),
    ).rejects.toThrow(/quote_lines_included_free/);
  });

  it("rejects a quote counter below 1", async () => {
    await expect(
      withRollback((tx) => tx.quoteCounter.create({ data: { year: 2097, lastSeq: 0 } })),
    ).rejects.toThrow(/quote_counters_seq_positive/);
  });

  it("rejects a second wording row", async () => {
    await expect(
      withRollback((tx) =>
        tx.quoteWording.create({
          data: {
            id: "other",
            tagline: "x",
            standardExclusions: [],
            monthlyTerms: [],
            onceOffTerms: [],
            commonTerms: [],
            everyVisitPoints: [],
            registrationNumber: "x",
            phone: "x",
            email: "x",
            website: "x",
          },
        }),
      ),
    ).rejects.toThrow(/quote_wording_singleton/);
  });

  it("rejects a validity of 0 days", async () => {
    await expect(
      withRollback((tx) =>
        tx.quoteWording.update({ where: { id: "singleton" }, data: { defaultValidityDays: 0 } }),
      ),
    ).rejects.toThrow(/quote_wording_validity_range/);
  });
});
