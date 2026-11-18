import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { DomainError, ForbiddenError, type Actor } from "./access";
import { addContact, removeContact, updateContact } from "./contacts";
import { createCustomer, getCustomer } from "./customers";
import { addProperty, archiveProperty, updateProperty } from "./properties";
import { contactSchema, customerSchema, propertySchema } from "./schemas";

const manager: Actor = { id: randomUUID(), role: "MANAGER" };
const crew: Actor = { id: randomUUID(), role: "CREW" };
const base = () => ({
  customer: customerSchema.parse({ type: "PERSON", displayName: "Child Test" }),
  contact: contactSchema.parse({ name: "First", email: `${randomUUID()}@example.com` }),
});

describe.skipIf(!dbTestsEnabled)("contacts and properties", () => {
  it("adds, updates and removes contacts but keeps at least one", async () => {
    await withRollback(async (tx) => {
      const { id } = await createCustomer(tx, manager, base());
      const second = await addContact(
        tx,
        manager,
        id,
        contactSchema.parse({ name: "Second", phone: "0821234567" }),
      );
      expect((await getCustomer(tx, manager, id))?.contacts).toHaveLength(2);

      await updateContact(
        tx,
        manager,
        second.id,
        contactSchema.parse({ name: "Second B", phone: "0821234567" }),
      );
      const updated = await tx.contact.findUnique({ where: { id: second.id } });
      expect(updated?.name).toBe("Second B");

      await removeContact(tx, manager, second.id);
      const remaining = (await getCustomer(tx, manager, id))?.contacts ?? [];
      expect(remaining).toHaveLength(1);
      await expect(removeContact(tx, manager, remaining[0]!.id)).rejects.toBeInstanceOf(
        DomainError,
      );

      const actions = (
        await tx.auditLog.findMany({ where: { entityId: id }, orderBy: { at: "asc" } })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          "customer.contact_added",
          "customer.contact_updated",
          "customer.contact_removed",
        ]),
      );
      const auditText = JSON.stringify(await tx.auditLog.findMany({ where: { entityId: id } }));
      expect(auditText).not.toContain("Second");
      expect(auditText).not.toContain("0821234567");
      expect(auditText).not.toContain("+27821234567");
    });
  });

  it("adds, updates and archives properties", async () => {
    await withRollback(async (tx) => {
      const { id } = await createCustomer(tx, manager, base());
      const p = await addProperty(
        tx,
        manager,
        id,
        propertySchema.parse({ label: "Cottage", addressLine1: "2 Test Road" }),
      );
      await updateProperty(
        tx,
        manager,
        p.id,
        propertySchema.parse({ label: "Cottage", addressLine1: "2 Test Road", monthlyFee: "400" }),
      );
      expect((await getCustomer(tx, manager, id))?.properties[0]?.agreedMonthlyFeeCents).toBe(
        40000,
      );
      await archiveProperty(tx, manager, p.id);
      expect((await getCustomer(tx, manager, id))?.properties).toHaveLength(0);

      const entries = await tx.auditLog.findMany({ where: { entityId: id } });
      expect(entries.map((a) => a.action)).toEqual(
        expect.arrayContaining([
          "customer.property_added",
          "customer.property_updated",
          "customer.property_archived",
        ]),
      );
      const updatedEntry = entries.find((a) => a.action === "customer.property_updated");
      expect((updatedEntry?.after as { changed: string[] }).changed).toEqual([
        "agreedMonthlyFeeCents",
      ]);
      const auditText = JSON.stringify(entries);
      expect(auditText).not.toContain("Test Road");
      expect(auditText).not.toContain("Cottage");
      expect(auditText).not.toContain("40000");
    });
  });

  it("refuses changes to a customer that does not exist", async () => {
    await withRollback(async (tx) => {
      await expect(
        addContact(
          tx,
          manager,
          randomUUID(),
          contactSchema.parse({ name: "X", email: "x@example.com" }),
        ),
      ).rejects.toBeInstanceOf(DomainError);
      await expect(
        addProperty(
          tx,
          manager,
          randomUUID(),
          propertySchema.parse({ label: "Y", addressLine1: "1 Nowhere Lane" }),
        ),
      ).rejects.toBeInstanceOf(DomainError);
    });
  });

  it("refuses changes to a contact or property that does not exist", async () => {
    await withRollback(async (tx) => {
      const c = contactSchema.parse({ name: "X", email: "x@example.com" });
      const p = propertySchema.parse({ label: "Y", addressLine1: "1 Nowhere Lane" });
      await expect(updateContact(tx, manager, randomUUID(), c)).rejects.toBeInstanceOf(DomainError);
      await expect(removeContact(tx, manager, randomUUID())).rejects.toBeInstanceOf(DomainError);
      await expect(updateProperty(tx, manager, randomUUID(), p)).rejects.toBeInstanceOf(
        DomainError,
      );
      await expect(archiveProperty(tx, manager, randomUUID())).rejects.toBeInstanceOf(DomainError);
    });
  });

  it("refuses crew every contact and property change", async () => {
    await withRollback(async (tx) => {
      const { id } = await createCustomer(tx, manager, base());
      const second = await addContact(
        tx,
        manager,
        id,
        contactSchema.parse({ name: "Second", phone: "0821234567" }),
      );
      const property = await addProperty(
        tx,
        manager,
        id,
        propertySchema.parse({ label: "Cottage", addressLine1: "2 Test Road" }),
      );
      const newContact = contactSchema.parse({ name: "Crew Added", phone: "0829876543" });
      const newProperty = propertySchema.parse({ label: "Crew", addressLine1: "9 Crew Street" });

      const attempts: Record<string, () => Promise<unknown>> = {
        addContact: () => addContact(tx, crew, id, newContact),
        updateContact: () => updateContact(tx, crew, second.id, newContact),
        removeContact: () => removeContact(tx, crew, second.id),
        addProperty: () => addProperty(tx, crew, id, newProperty),
        updateProperty: () => updateProperty(tx, crew, property.id, newProperty),
        archiveProperty: () => archiveProperty(tx, crew, property.id),
      };
      for (const [name, attempt] of Object.entries(attempts)) {
        await expect(attempt(), name).rejects.toBeInstanceOf(ForbiddenError);
      }

      // Nothing was changed by the refused attempts.
      const after = await getCustomer(tx, manager, id);
      expect(after?.contacts.map((c) => c.name).sort()).toEqual(["First", "Second"]);
      expect(after?.properties.map((p) => p.label)).toEqual(["Cottage"]);
      expect(after?.properties[0]?.addressLine1).toBe("2 Test Road");
    });
  });

  it("refuses changes to an anonymised customer", async () => {
    await withRollback(async (tx) => {
      const { id } = await createCustomer(tx, manager, base());
      const contact = (await getCustomer(tx, manager, id))!.contacts[0]!;
      await tx.customer.update({ where: { id }, data: { anonymisedAt: new Date() } });
      await expect(
        addContact(tx, manager, id, contactSchema.parse({ name: "Z", email: "z@example.com" })),
      ).rejects.toBeInstanceOf(DomainError);
      await expect(
        updateContact(
          tx,
          manager,
          contact.id,
          contactSchema.parse({ name: "Z", phone: "0821111111" }),
        ),
      ).rejects.toBeInstanceOf(DomainError);
    });
  });
});
