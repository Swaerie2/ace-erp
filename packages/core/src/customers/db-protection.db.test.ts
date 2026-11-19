import { describe, expect, it } from "vitest";
import { dbTestsEnabled, withRollback } from "../testing/rollback";

describe.skipIf(!dbTestsEnabled)("customers database protections", () => {
  it("blocks the public API from reading the new tables", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(url && key).toBeTruthy();
    for (const table of ["customers", "contacts", "properties"]) {
      const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
        headers: { apikey: key!, Authorization: `Bearer ${key}` },
      });
      expect([401, 403]).toContain(res.status);
    }
  });

  it("has row level security on, and no direct read access for the public roles", async () => {
    await withRollback(async (tx) => {
      const tables = ["customers", "contacts", "properties"];
      const rls = await tx.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
        select relname, relrowsecurity from pg_class
        where relname in ('customers', 'contacts', 'properties')`;
      expect(rls.map((r) => r.relname).sort()).toEqual([...tables].sort());
      for (const row of rls) expect(row.relrowsecurity, row.relname).toBe(true);

      const roles = await tx.$queryRaw<{ rolname: string }[]>`
        select rolname from pg_roles where rolname in ('authenticated', 'anon')`;
      for (const { rolname } of roles) {
        for (const table of tables) {
          const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`
            select has_table_privilege(${rolname}, ${table}, 'select') as allowed`;
          expect(row?.allowed, `${rolname} select on ${table}`).toBe(false);
        }
      }
    });
  });

  it("rejects an uppercase contact email", async () => {
    await expect(
      withRollback(async (tx) => {
        const customer = await tx.customer.create({
          data: { type: "PERSON", displayName: "Protection Test" },
        });
        await tx.contact.create({
          data: { customerId: customer.id, name: "X", email: "UPPER@Example.com" },
        });
      }),
    ).rejects.toThrow(/contacts_email_lowercase/);
  });

  it("rejects a blank customer name and a negative fee", async () => {
    await expect(
      withRollback((tx) => tx.customer.create({ data: { type: "PERSON", displayName: "   " } })),
    ).rejects.toThrow(/customers_display_name_not_blank/);
    await expect(
      withRollback(async (tx) => {
        const c = await tx.customer.create({ data: { type: "PERSON", displayName: "Fee Test" } });
        await tx.property.create({
          data: {
            customerId: c.id,
            label: "x",
            addressLine1: "1 Test St",
            agreedMonthlyFeeCents: -1,
          },
        });
      }),
    ).rejects.toThrow(/properties_fee_not_negative/);
  });

  it("rejects a negative lawn size", async () => {
    await expect(
      withRollback(async (tx) => {
        const c = await tx.customer.create({ data: { type: "PERSON", displayName: "Lawn Test" } });
        await tx.property.create({
          data: { customerId: c.id, label: "x", addressLine1: "1 Test St", lawnSizeSqm: -1 },
        });
      }),
    ).rejects.toThrow(/properties_lawn_not_negative/);
  });

  it("numbers customers upwards", async () => {
    await withRollback(async (tx) => {
      const a = await tx.customer.create({ data: { type: "PERSON", displayName: "A Test" } });
      const b = await tx.customer.create({ data: { type: "PERSON", displayName: "B Test" } });
      expect(b.number).toBeGreaterThan(a.number);
    });
  });
});
