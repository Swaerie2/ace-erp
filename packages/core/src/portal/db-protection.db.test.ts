import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dbTestsEnabled, withRollback } from "../testing/rollback";

const TABLES = ["portal_codes", "portal_sessions"];

describe.skipIf(!dbTestsEnabled)("portal sign-in tables: database protections", () => {
  it("blocks the public API from reading the sign-in tables", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(url && key).toBeTruthy();
    for (const table of TABLES) {
      const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
        headers: { apikey: key!, Authorization: `Bearer ${key}` },
      });
      expect([401, 403, 404]).toContain(res.status);
    }
  });

  it("has row level security on, and no access for the public roles", async () => {
    await withRollback(async (tx) => {
      const rls = await tx.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
        select relname, relrowsecurity from pg_class where relname in ('portal_codes', 'portal_sessions')`;
      expect(rls.map((r) => r.relname).sort()).toEqual([...TABLES].sort());
      for (const row of rls) expect(row.relrowsecurity, row.relname).toBe(true);
      const roles = await tx.$queryRaw<{ rolname: string }[]>`
        select rolname from pg_roles where rolname in ('authenticated', 'anon')`;
      for (const { rolname } of roles) {
        for (const table of TABLES) {
          for (const p of ["select", "insert", "update", "delete"]) {
            const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`
              select has_table_privilege(${rolname}, ${table}, ${p}) as allowed`;
            expect(row?.allowed, `${rolname} ${p} on ${table}`).toBe(false);
          }
        }
      }
    });
  });

  it("rejects an uppercase email on a sign-in code", async () => {
    await expect(
      withRollback((tx) =>
        tx.portalCode.create({
          data: {
            email: "ZZ.Upper@Example.com",
            codeHash: "x",
            salt: "y",
            expiresAt: new Date(),
          },
        }),
      ),
    ).rejects.toThrow(/portal_codes_email_lowercase/);
  });

  it("rejects an uppercase email on a session", async () => {
    await expect(
      withRollback((tx) =>
        tx.portalSession.create({
          data: {
            tokenHash: randomUUID(),
            email: "ZZ.Upper@Example.com",
            lastSeenAt: new Date(),
            expiresAt: new Date(),
            absoluteExpiresAt: new Date(),
          },
        }),
      ),
    ).rejects.toThrow(/portal_sessions_email_lowercase/);
  });

  it("rejects a customer that manages itself", async () => {
    await expect(
      withRollback(async (tx) => {
        const c = await tx.customer.create({
          data: { type: "COMPANY", displayName: "ZZ E2E Self Manager" },
          select: { id: true },
        });
        await tx.customer.update({ where: { id: c.id }, data: { managedById: c.id } });
      }),
    ).rejects.toThrow(/customers_not_managed_by_itself/);
  });

  it("does not let a customer that still manages a complex be deleted", async () => {
    await expect(
      withRollback(async (tx) => {
        const agency = await tx.customer.create({
          data: { type: "COMPANY", displayName: "ZZ E2E Agency" },
          select: { id: true },
        });
        await tx.customer.create({
          data: { type: "COMPANY", displayName: "ZZ E2E Complex", managedById: agency.id },
        });
        await tx.customer.delete({ where: { id: agency.id } });
      }),
    ).rejects.toThrow(/customers_managedById_fkey|Foreign key constraint/);
  });
});
