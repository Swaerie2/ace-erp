import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { ForbiddenError, type Actor } from "./access";
import {
  archiveCustomer,
  createCustomer,
  getCustomer,
  getCustomerForCrew,
  listCustomers,
  listCustomersForCrew,
  restoreCustomer,
  updateCustomer,
} from "./customers";
import { findDuplicateContacts } from "./duplicates";
import { contactSchema, customerSchema, propertySchema } from "./schemas";

const manager: Actor = { id: randomUUID(), role: "MANAGER" };
const crew: Actor = { id: randomUUID(), role: "CREW" };

const customer = (over: Record<string, string> = {}) =>
  customerSchema.parse({ type: "PERSON", displayName: "Test Person", ...over });
const contact = () =>
  contactSchema.parse({ name: "Test Contact", email: "test@example.com", phone: "082 123 4567" });
const property = () =>
  propertySchema.parse({
    label: "Main",
    addressLine1: "1 Testing Street",
    suburb: "Testville",
    frequency: "WEEKLY",
    // An unusual amount, so the "crew must not see fees" test cannot match by accident
    // (ids contain digits, so a round number like 850 could appear inside one).
    monthlyFee: "851.37",
    accessNotes: "Gate code 1234",
    extrasNote: "Weed treatment",
  });

describe.skipIf(!dbTestsEnabled)("customers data layer", () => {
  it("creates a customer with contact and property and audits it without personal values", async () => {
    await withRollback(async (tx) => {
      const { id, number } = await createCustomer(tx, manager, {
        customer: customer(),
        contact: contact(),
        property: property(),
      });
      const full = await getCustomer(tx, manager, id);
      expect(full?.contacts).toHaveLength(1);
      expect(full?.properties).toHaveLength(1);
      expect(full?.properties[0]?.agreedMonthlyFeeCents).toBe(85137);

      const audit = await tx.auditLog.findMany({ where: { entityId: id } });
      expect(audit.map((a) => a.action)).toEqual(["customer.created"]);
      const text = JSON.stringify(audit);
      expect(text).not.toContain("Test Person");
      expect(text).not.toContain("test@example.com");
      expect(number).toBeGreaterThan(0);
    });
  });

  it("records which fields changed on update, never their values", async () => {
    await withRollback(async (tx) => {
      const { id } = await createCustomer(tx, manager, {
        customer: customer(),
        contact: contact(),
      });
      await updateCustomer(
        tx,
        manager,
        id,
        customer({ displayName: "Renamed Person", notes: "secret note" }),
      );
      const entry = await tx.auditLog.findFirst({
        where: { entityId: id, action: "customer.updated" },
      });
      const after = entry?.after as { changed: string[] };
      expect(after.changed.sort()).toEqual(["displayName", "notes"]);
      expect(JSON.stringify(entry)).not.toContain("Renamed");
      expect(JSON.stringify(entry)).not.toContain("secret");
    });
  });

  it("archives and restores to the previous status", async () => {
    await withRollback(async (tx) => {
      const { id } = await createCustomer(tx, manager, {
        customer: customer({ status: "PAUSED" }),
        contact: contact(),
      });
      await archiveCustomer(tx, manager, id);
      expect((await getCustomer(tx, manager, id))?.status).toBe("ARCHIVED");
      await restoreCustomer(tx, manager, id);
      const back = await getCustomer(tx, manager, id);
      expect(back?.status).toBe("PAUSED");
      expect(back?.archivedAt).toBeNull();
    });
  });

  it("lists, searches and hides archived by default", async () => {
    await withRollback(async (tx) => {
      const a = await createCustomer(tx, manager, {
        customer: customer({ displayName: "Zzqx Alpha" }),
        contact: contact(),
        property: property(),
      });
      const b = await createCustomer(tx, manager, {
        customer: customer({ displayName: "Zzqx Beta" }),
        contact: contactSchema.parse({ name: "B", email: "beta@example.com" }),
      });
      await archiveCustomer(tx, manager, b.id);

      const byName = await listCustomers(tx, manager, { q: "zzqx" });
      expect(byName.items.map((c) => c.id)).toEqual([a.id]);

      const withArchived = await listCustomers(tx, manager, { q: "zzqx", status: "ALL" });
      expect(withArchived.total).toBe(2);

      const byNumber = await listCustomers(tx, manager, {
        q: `C-${String(a.number).padStart(4, "0")}`,
      });
      expect(byNumber.items.map((c) => c.id)).toContain(a.id);

      const byPhone = await listCustomers(tx, manager, { q: "0821234567" });
      expect(byPhone.items.map((c) => c.id)).toContain(a.id);

      const byStreet = await listCustomers(tx, manager, { q: "testing street" });
      expect(byStreet.items.map((c) => c.id)).toContain(a.id);
    });
  });

  it("gives crew only the safe view and refuses crew the full list", async () => {
    await withRollback(async (tx) => {
      const { id } = await createCustomer(tx, manager, {
        customer: customer({ displayName: "Crewview Person", notes: "internal" }),
        contact: contact(),
        property: property(),
      });
      const view = await getCustomerForCrew(tx, crew, id);
      expect(Object.keys(view ?? {}).sort()).toEqual([
        "displayName",
        "id",
        "number",
        "properties",
        "status",
      ]);
      expect(Object.keys(view?.properties[0] ?? {}).sort()).toEqual([
        "accessNotes",
        "addressLine1",
        "addressLine2",
        "city",
        "id",
        "label",
        "mapUrl",
        "postalCode",
        "suburb",
      ]);
      const text = JSON.stringify(view);
      for (const secret of [
        "test@example.com",
        "+27821234567",
        "85137",
        "851.37",
        "Weed",
        "internal",
      ]) {
        expect(text).not.toContain(secret);
      }
      const list = await listCustomersForCrew(tx, crew, { q: "crewview" });
      expect(list.items).toHaveLength(1);
      expect(JSON.stringify(list)).not.toContain("test@example.com");

      await expect(listCustomers(tx, crew, {})).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getCustomer(tx, crew, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        createCustomer(tx, crew, { customer: customer(), contact: contact() }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  it("finds duplicate contacts by email or phone", async () => {
    await withRollback(async (tx) => {
      const first = await createCustomer(tx, manager, { customer: customer(), contact: contact() });
      const matches = await findDuplicateContacts(tx, manager, {
        emails: ["test@example.com"],
        phones: ["+27829999999"],
      });
      expect(matches.map((m) => m.customerId)).toContain(first.id);
      expect(matches[0]?.reason).toBe("email");
      const none = await findDuplicateContacts(tx, manager, {
        emails: ["test@example.com"],
        phones: [],
        excludeCustomerId: first.id,
      });
      expect(none).toHaveLength(0);
    });
  });
});
