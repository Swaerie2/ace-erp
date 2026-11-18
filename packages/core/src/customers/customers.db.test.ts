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
// Every test uses its own email, phone and name token, so nothing here can collide with, or be
// found by accident among, the other rows that already live in the dev database.
const token = () => randomUUID().replaceAll("-", "").slice(0, 10);
const uniquePhone = () => `082${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
const contact = () =>
  contactSchema.parse({
    name: "Test Contact",
    email: `${randomUUID()}@example.com`,
    phone: uniquePhone(),
  });
const property = (street = "1 Testing Street") =>
  propertySchema.parse({
    label: "Main",
    addressLine1: street,
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
      const c = contact();
      const { id, number } = await createCustomer(tx, manager, {
        customer: customer(),
        contact: c,
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
      expect(text).not.toContain(c.email);
      expect(text).not.toContain(c.phone);
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
      const key = `zzqx${token()}`;
      const street = `${key} Testing Street`;
      const phone = uniquePhone();
      const a = await createCustomer(tx, manager, {
        customer: customer({ displayName: `${key} Alpha` }),
        contact: contactSchema.parse({ name: "A", email: `${randomUUID()}@example.com`, phone }),
        property: property(street),
      });
      const b = await createCustomer(tx, manager, {
        customer: customer({ displayName: `${key} Beta` }),
        contact: contactSchema.parse({ name: "B", email: `${randomUUID()}@example.com` }),
      });
      await archiveCustomer(tx, manager, b.id);

      const byName = await listCustomers(tx, manager, { q: key });
      expect(byName.items.map((c) => c.id)).toEqual([a.id]);

      const withArchived = await listCustomers(tx, manager, { q: key, status: "ALL" });
      expect(withArchived.total).toBe(2);

      const byNumber = await listCustomers(tx, manager, {
        q: `C-${String(a.number).padStart(4, "0")}`,
      });
      expect(byNumber.items.map((c) => c.id)).toContain(a.id);

      const byPhone = await listCustomers(tx, manager, { q: phone });
      expect(byPhone.items.map((c) => c.id)).toContain(a.id);

      const byStreet = await listCustomers(tx, manager, { q: `${key} testing street` });
      expect(byStreet.items.map((c) => c.id)).toEqual([a.id]);
    });
  });

  it("gives crew only the safe view and refuses crew the full list", async () => {
    await withRollback(async (tx) => {
      const key = `crewview${token()}`;
      const c = contact();
      const { id } = await createCustomer(tx, manager, {
        customer: customer({ displayName: `${key} Person`, notes: "internal" }),
        contact: c,
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
      for (const secret of [c.email ?? "", c.phone ?? "", "85137", "851.37", "Weed", "internal"]) {
        expect(text).not.toContain(secret);
      }
      const list = await listCustomersForCrew(tx, crew, { q: key });
      expect(list.items).toHaveLength(1);
      expect(JSON.stringify(list)).not.toContain(c.email ?? "");

      await expect(listCustomers(tx, crew, {})).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getCustomer(tx, crew, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        createCustomer(tx, crew, { customer: customer(), contact: contact() }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  it("finds duplicate contacts by email or phone", async () => {
    await withRollback(async (tx) => {
      const c = contact();
      const first = await createCustomer(tx, manager, { customer: customer(), contact: c });
      const byEmail = await findDuplicateContacts(tx, manager, {
        emails: [c.email ?? ""],
        phones: [uniquePhone()],
      });
      expect(byEmail.map((m) => m.customerId)).toEqual([first.id]);
      expect(byEmail[0]?.reason).toBe("email");

      const byPhone = await findDuplicateContacts(tx, manager, {
        emails: [`${randomUUID()}@example.com`],
        phones: [c.phone ?? ""],
      });
      expect(byPhone.map((m) => m.customerId)).toEqual([first.id]);
      expect(byPhone[0]?.reason).toBe("phone");

      const none = await findDuplicateContacts(tx, manager, {
        emails: [c.email ?? ""],
        phones: [],
        excludeCustomerId: first.id,
      });
      expect(none).toHaveLength(0);
    });
  });

  it("refuses crew every management-only customer action", async () => {
    await withRollback(async (tx) => {
      const { id } = await createCustomer(tx, manager, {
        customer: customer(),
        contact: contact(),
      });
      const attempts: Record<string, () => Promise<unknown>> = {
        updateCustomer: () => updateCustomer(tx, crew, id, customer({ displayName: "Changed" })),
        archiveCustomer: () => archiveCustomer(tx, crew, id),
        restoreCustomer: () => restoreCustomer(tx, crew, id),
        findDuplicateContacts: () =>
          findDuplicateContacts(tx, crew, { emails: ["a@example.com"], phones: [] }),
      };
      for (const [name, attempt] of Object.entries(attempts)) {
        await expect(attempt(), name).rejects.toBeInstanceOf(ForbiddenError);
      }
      // Nothing was changed by the refused attempts.
      const after = await getCustomer(tx, manager, id);
      expect(after?.displayName).toBe("Test Person");
      expect(after?.status).toBe("ACTIVE");
    });
  });
});
