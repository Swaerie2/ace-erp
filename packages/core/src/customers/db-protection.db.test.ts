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
