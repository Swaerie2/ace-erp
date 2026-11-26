import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../customers/access";
import { archiveCustomer, createCustomer } from "../customers/customers";
import { formatCustomerNumber } from "../customers/number";
import { anonymiseCustomer } from "../customers/privacy";
import { contactSchema, customerSchema } from "../customers/schemas";
import { crew, manager, owner } from "../quotes/test-helpers";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import {
  HIERARCHY_MESSAGES,
  clearManagedBy,
  getCustomerHierarchy,
  searchAgencies,
  setBillsToManager,
  setManagedBy,
} from "./hierarchy";

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];
const tok = () => randomUUID().replaceAll("-", "").slice(0, 10);

async function company(tx: Tx, name = `ZZ E2E Company ${tok()}`) {
  const { id, number } = await createCustomer(tx, manager, {
    customer: customerSchema.parse({ type: "COMPANY", displayName: name, status: "ACTIVE" }),
    contact: contactSchema.parse({ name: "ZZ E2E Contact", email: `${randomUUID()}@example.com` }),
  });
  return { id, number, name };
}

const audit = (tx: Tx, entityId: string, action: string) =>
  tx.auditLog.findMany({
    where: { entityType: "customer", entityId, action },
    orderBy: { at: "asc" },
  });

describe.skipIf(!dbTestsEnabled)("managing agencies: the link rules", () => {
  it("links a complex to an agency, shows it on both sides, and audits ids only", async () => {
    await withRollback(async (tx) => {
      const agency = await company(tx);
      const complex = await company(tx);
      await setManagedBy(tx, manager, complex.id, agency.id);

      const row = await tx.customer.findUniqueOrThrow({ where: { id: complex.id } });
      expect(row).toMatchObject({ managedById: agency.id, billsToManager: true });
      expect((await getCustomerHierarchy(tx, manager, complex.id)).manager).toEqual({
        id: agency.id,
        number: agency.number,
        displayName: agency.name,
      });
      const fromAgency = await getCustomerHierarchy(tx, manager, agency.id);
      expect(fromAgency.manager).toBeNull();
      expect(fromAgency.complexes).toEqual([
        {
          id: complex.id,
          number: complex.number,
          displayName: complex.name,
          status: "ACTIVE",
          propertyCount: 0,
          quoteCount: 0,
        },
      ]);

      const set = await audit(tx, complex.id, "customer.manager_set");
      expect(set).toHaveLength(1);
      expect(set[0]?.after).toEqual({ managerId: agency.id, previousManagerId: null });
      const added = await audit(tx, agency.id, "customer.complex_added");
      expect(added[0]?.after).toEqual({ complexId: complex.id });
      const text = JSON.stringify([...set, ...added]);
      expect(text).not.toContain(agency.name);
      expect(text).not.toContain(complex.name);

      // Linking again to the same agency changes nothing and writes nothing.
      await setManagedBy(tx, manager, complex.id, agency.id);
      expect(await audit(tx, complex.id, "customer.manager_set")).toHaveLength(1);
    });
  });

  it("moves a complex to another agency, switches who is billed, and clears the link", async () => {
    await withRollback(async (tx) => {
      const first = await company(tx);
      const second = await company(tx);
      const complex = await company(tx);
      await setManagedBy(tx, manager, complex.id, first.id);
      await setBillsToManager(tx, manager, complex.id, false);
      expect(
        (await tx.customer.findUniqueOrThrow({ where: { id: complex.id } })).billsToManager,
      ).toBe(false);
      expect((await audit(tx, complex.id, "customer.bills_to_changed"))[0]?.after).toEqual({
        billsToManager: false,
      });

      await setManagedBy(tx, owner, complex.id, second.id);
      const moved = await audit(tx, complex.id, "customer.manager_set");
      expect(moved[1]?.after).toEqual({ managerId: second.id, previousManagerId: first.id });
      expect((await audit(tx, first.id, "customer.complex_removed"))[0]?.after).toEqual({
        complexId: complex.id,
      });

      await clearManagedBy(tx, manager, complex.id);
      const cleared = await tx.customer.findUniqueOrThrow({ where: { id: complex.id } });
      expect(cleared).toMatchObject({ managedById: null, billsToManager: true });
      expect((await audit(tx, complex.id, "customer.manager_cleared"))[0]?.after).toEqual({
        previousManagerId: second.id,
      });
      // Clearing again does nothing; the switch needs a link.
      await clearManagedBy(tx, manager, complex.id);
      expect(await audit(tx, complex.id, "customer.manager_cleared")).toHaveLength(1);
      await expect(setBillsToManager(tx, manager, complex.id, false)).rejects.toThrow(
        HIERARCHY_MESSAGES.notManaged,
      );
    });
  });

  it("refuses self links, chains and cycles", async () => {
    await withRollback(async (tx) => {
      const agency = await company(tx);
      const complex = await company(tx);
      const other = await company(tx);
      await expect(setManagedBy(tx, manager, agency.id, agency.id)).rejects.toThrow(
        HIERARCHY_MESSAGES.self,
      );
      await setManagedBy(tx, manager, complex.id, agency.id);
      // the complex is managed, so it cannot be an agency (no chains)
      await expect(setManagedBy(tx, manager, other.id, complex.id)).rejects.toThrow(
        HIERARCHY_MESSAGES.agencyIsManaged,
      );
      // the agency manages a complex, so it cannot be managed (no chains)
      await expect(setManagedBy(tx, manager, agency.id, other.id)).rejects.toThrow(
        HIERARCHY_MESSAGES.complexManagesOthers,
      );
      // and the cycle agency -> complex is refused (the complex is itself managed)
      await expect(setManagedBy(tx, manager, agency.id, complex.id)).rejects.toThrow(
        HIERARCHY_MESSAGES.agencyIsManaged,
      );
      expect(
        (await tx.customer.findUniqueOrThrow({ where: { id: agency.id } })).managedById,
      ).toBeNull();
      expect(
        (await tx.customer.findUniqueOrThrow({ where: { id: other.id } })).managedById,
      ).toBeNull();
    });
  });

  it("refuses an anonymised or archived agency, and anyone but owner or manager", async () => {
    await withRollback(async (tx) => {
      const gone = await company(tx);
      const archived = await company(tx);
      const complex = await company(tx);
      await anonymiseCustomer(tx, owner, gone.id, formatCustomerNumber(gone.number));
      await archiveCustomer(tx, manager, archived.id);
      await expect(setManagedBy(tx, manager, complex.id, gone.id)).rejects.toThrow(
        HIERARCHY_MESSAGES.agencyAnonymised,
      );
      await expect(setManagedBy(tx, manager, complex.id, archived.id)).rejects.toThrow(
        HIERARCHY_MESSAGES.agencyArchived,
      );
      await expect(setManagedBy(tx, manager, complex.id, randomUUID())).rejects.toThrow(
        HIERARCHY_MESSAGES.agencyMissing,
      );
      await expect(setManagedBy(tx, crew, complex.id, archived.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(clearManagedBy(tx, crew, complex.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setBillsToManager(tx, crew, complex.id, true)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(getCustomerHierarchy(tx, crew, complex.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        searchAgencies(tx, crew, { q: "ZZ", excludeId: complex.id }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  it("searches agencies by name, leaving out the customer itself, managed, archived and anonymised ones", async () => {
    await withRollback(async (tx) => {
      const t = tok();
      const agency = await company(tx, `ZZ E2E Agency ${t} North`);
      const self = await company(tx, `ZZ E2E Agency ${t} Self`);
      const managed = await company(tx, `ZZ E2E Agency ${t} Managed`);
      const archived = await company(tx, `ZZ E2E Agency ${t} Archived`);
      const gone = await company(tx, `ZZ E2E Agency ${t} Gone`);
      await setManagedBy(tx, manager, managed.id, agency.id);
      await archiveCustomer(tx, manager, archived.id);
      await anonymiseCustomer(tx, owner, gone.id, formatCustomerNumber(gone.number));
      const found = await searchAgencies(tx, manager, { q: `agency ${t}`, excludeId: self.id });
      expect(found).toEqual([{ id: agency.id, number: agency.number, displayName: agency.name }]);
      expect(await searchAgencies(tx, manager, { q: "Z", excludeId: self.id })).toEqual([]);
    });
  });
});
