import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DomainError, ForbiddenError, type Actor } from "../customers/access";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { serviceSchema } from "./schemas";
import {
  archiveService,
  createService,
  getService,
  listServices,
  moveService,
  restoreService,
  updateService,
} from "./services";

const owner: Actor = { id: randomUUID(), role: "OWNER" };
const manager: Actor = { id: randomUUID(), role: "MANAGER" };
const crew: Actor = { id: randomUUID(), role: "CREW" };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// A unique name per call, so nothing collides with the rows already in the dev database.
const token = () => randomUUID().replaceAll("-", "").slice(0, 10);
const input = (over: Record<string, string> = {}) =>
  serviceSchema.parse({
    name: `Test Service ${token()}`,
    description: `Test description ${token()}`,
    kind: "CORE",
    ...over,
  });

describe.skipIf(!dbTestsEnabled)("services data layer", () => {
  it("adds a service at the end and audits it without the typed text", async () => {
    await withRollback(async (tx) => {
      const before = await listServices(tx, manager);
      const data = input();
      const { id } = await createService(tx, manager, data);

      const after = await listServices(tx, manager);
      expect(after).toHaveLength(before.length + 1);
      expect(after.at(-1)?.id).toBe(id);
      expect(after.at(-1)?.kind).toBe("CORE");

      const audit = await tx.auditLog.findMany({ where: { entityId: id } });
      expect(audit.map((a) => a.action)).toEqual(["service.created"]);
      expect(audit[0]?.entityType).toBe("service");
      const text = JSON.stringify(audit);
      expect(text).not.toContain(data.name);
      expect(text).not.toContain(data.description);
    });
  });

  it("refuses a duplicate name ignoring case, including a switched-off service", async () => {
    await withRollback(async (tx) => {
      const data = input({ name: `Dup ${token()}` });
      const { id } = await createService(tx, manager, data);
      await expect(
        createService(tx, manager, { ...data, name: data.name.toUpperCase() }),
      ).rejects.toThrow(DomainError);
      await archiveService(tx, manager, id);
      await expect(
        createService(tx, manager, { ...data, name: data.name.toLowerCase() }),
      ).rejects.toThrow("A service with that name already exists.");
    });
  });

  it("edits a service and audits only the field names", async () => {
    await withRollback(async (tx) => {
      const { id } = await createService(tx, manager, input());
      const edited = input({ kind: "OPTIONAL_EXTRA" });
      await updateService(tx, manager, id, edited);

      const saved = await getService(tx, manager, id);
      expect(saved?.name).toBe(edited.name);
      expect(saved?.kind).toBe("OPTIONAL_EXTRA");

      const audit = await tx.auditLog.findMany({
        where: { entityId: id, action: "service.updated" },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]?.after).toEqual({ changed: ["name", "description", "kind"] });
      const text = JSON.stringify(audit);
      expect(text).not.toContain(edited.name);
      expect(text).not.toContain(edited.description);
    });
  });

  it("writes nothing when a save changes nothing", async () => {
    await withRollback(async (tx) => {
      const data = input();
      const { id } = await createService(tx, manager, data);
      const before = await getService(tx, manager, id);
      await sleep(20);
      await updateService(tx, manager, id, data);
      const after = await getService(tx, manager, id);
      expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
      const updates = await tx.auditLog.count({
        where: { entityId: id, action: "service.updated" },
      });
      expect(updates).toBe(0);
    });
  });

  it("lets a service change only the case of its own name, but not take another's name", async () => {
    await withRollback(async (tx) => {
      const a = input({ name: `Alpha ${token()}` });
      const b = input({ name: `Bravo ${token()}` });
      const { id: aId } = await createService(tx, manager, a);
      await createService(tx, manager, b);
      await updateService(tx, manager, aId, { ...a, name: a.name.toUpperCase() });
      expect((await getService(tx, manager, aId))?.name).toBe(a.name.toUpperCase());
      await expect(
        updateService(tx, manager, aId, { ...a, name: b.name.toLowerCase() }),
      ).rejects.toThrow("A service with that name already exists.");
    });
  });

  it("switches a service off and on; off hides it, on puts it back at the end; repeats do nothing", async () => {
    await withRollback(async (tx) => {
      const { id } = await createService(tx, manager, input());
      await createService(tx, manager, input()); // so "the end" is not already this one

      await archiveService(tx, manager, id);
      expect((await listServices(tx, manager)).some((s) => s.id === id)).toBe(false);
      expect(
        (await listServices(tx, manager, { includeArchived: true })).some((s) => s.id === id),
      ).toBe(true);
      await archiveService(tx, manager, id); // already off: nothing happens
      expect(await tx.auditLog.count({ where: { entityId: id, action: "service.archived" } })).toBe(
        1,
      );

      await restoreService(tx, manager, id);
      const active = await listServices(tx, manager);
      expect(active.at(-1)?.id).toBe(id);
      expect(active.at(-1)?.archivedAt).toBeNull();
      await restoreService(tx, manager, id); // already on: nothing happens
      expect(await tx.auditLog.count({ where: { entityId: id, action: "service.restored" } })).toBe(
        1,
      );
    });
  });

  it("moves a service up and down past its neighbour, and does nothing at the ends", async () => {
    await withRollback(async (tx) => {
      const { id: a } = await createService(tx, manager, input());
      const { id: b } = await createService(tx, manager, input());
      const lastTwo = async () => (await listServices(tx, manager)).slice(-2).map((s) => s.id);
      expect(await lastTwo()).toEqual([a, b]);

      await moveService(tx, manager, b, "up");
      expect(await lastTwo()).toEqual([b, a]);
      await moveService(tx, manager, b, "down");
      expect(await lastTwo()).toEqual([a, b]);

      // The last service cannot go further down, and the first cannot go further up.
      await moveService(tx, manager, b, "down");
      expect(await lastTwo()).toEqual([a, b]);
      const first = (await listServices(tx, manager))[0];
      await moveService(tx, manager, first!.id, "up");
      expect((await listServices(tx, manager))[0]?.id).toBe(first!.id);
      expect(
        await tx.auditLog.count({ where: { entityId: first!.id, action: "service.moved" } }),
      ).toBe(0);

      const moves = await tx.auditLog.findMany({
        where: { entityId: b, action: "service.moved" },
        orderBy: { at: "asc" },
      });
      expect(moves.map((m) => m.after)).toEqual([{ direction: "up" }, { direction: "down" }]);
    });
  });

  it("does not move a switched-off or unknown service", async () => {
    await withRollback(async (tx) => {
      const { id } = await createService(tx, manager, input());
      await archiveService(tx, manager, id);
      await expect(moveService(tx, manager, id, "up")).rejects.toThrow(DomainError);
      await expect(moveService(tx, manager, randomUUID(), "up")).rejects.toThrow(DomainError);
    });
  });

  it("says a missing service could not be found", async () => {
    await withRollback(async (tx) => {
      await expect(updateService(tx, manager, randomUUID(), input())).rejects.toThrow(
        "That service could not be found.",
      );
      await expect(archiveService(tx, manager, randomUUID())).rejects.toThrow(DomainError);
      await expect(restoreService(tx, manager, randomUUID())).rejects.toThrow(DomainError);
      expect(await getService(tx, manager, randomUUID())).toBeNull();
    });
  });

  it("lets the owner do everything the manager can, and refuses crew every function", async () => {
    await withRollback(async (tx) => {
      const { id } = await createService(tx, owner, input());
      expect((await listServices(tx, owner)).some((s) => s.id === id)).toBe(true);

      await expect(listServices(tx, crew)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getService(tx, crew, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(createService(tx, crew, input())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(updateService(tx, crew, id, input())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(archiveService(tx, crew, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(restoreService(tx, crew, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(moveService(tx, crew, id, "up")).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});

describe.skipIf(!dbTestsEnabled)("services database protections", () => {
  it("blocks the public API and the public database roles from the table", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(url && key).toBeTruthy();
    const res = await fetch(`${url}/rest/v1/services?select=*`, {
      headers: { apikey: key!, Authorization: `Bearer ${key}` },
    });
    expect([401, 403]).toContain(res.status);

    await withRollback(async (tx) => {
      const [rls] = await tx.$queryRaw<{ relrowsecurity: boolean }[]>`
        select relrowsecurity from pg_class where relname = 'services'`;
      expect(rls?.relrowsecurity).toBe(true);
      const roles = await tx.$queryRaw<{ rolname: string }[]>`
        select rolname from pg_roles where rolname in ('authenticated', 'anon')`;
      for (const { rolname } of roles) {
        const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`
          select has_table_privilege(${rolname}, 'services', 'select') as allowed`;
        expect(row?.allowed, `${rolname} select on services`).toBe(false);
      }
    });
  });

  it("stops two services sharing a name ignoring case, even around the code", async () => {
    await expect(
      withRollback(async (tx) => {
        const name = `Index Test ${token()}`;
        await tx.service.create({ data: { name, description: "x", sortOrder: 900 } });
        await tx.service.create({
          data: { name: name.toUpperCase(), description: "y", sortOrder: 901 },
        });
      }),
    ).rejects.toThrow(/services_name_lower_key|Unique constraint/);
  });

  it("rejects a blank name and a blank description", async () => {
    await expect(
      withRollback((tx) =>
        tx.service.create({ data: { name: "   ", description: "x", sortOrder: 900 } }),
      ),
    ).rejects.toThrow(/services_name_not_blank/);
    await expect(
      withRollback((tx) =>
        tx.service.create({
          data: { name: `Blank ${token()}`, description: "  ", sortOrder: 900 },
        }),
      ),
    ).rejects.toThrow(/services_description_not_blank/);
  });
});
