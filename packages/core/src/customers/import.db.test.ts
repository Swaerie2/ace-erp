import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { ForbiddenError, type Actor } from "./access";
import type { RawImportRow } from "./csv";
import { createCustomer } from "./customers";
import { commitImport, prepareImport } from "./import";
import { contactSchema, customerSchema } from "./schemas";

const manager: Actor = { id: randomUUID(), role: "MANAGER" };

const row = (over: Partial<RawImportRow>): RawImportRow => ({
  type: "",
  display_name: "Import Person",
  company_name: "",
  contact_name: "",
  email: "",
  phone: "",
  billing_line1: "",
  billing_suburb: "",
  billing_city: "",
  billing_postal_code: "",
  property_address: "",
  property_suburb: "",
  property_city: "",
  frequency: "",
  monthly_fee_rand: "",
  extras: "",
  source: "",
  notes: "",
  ...over,
});

describe.skipIf(!dbTestsEnabled)("customer import", () => {
  it("sorts rows into create, duplicate and error", async () => {
    await withRollback(async (tx) => {
      await createCustomer(tx, manager, {
        customer: customerSchema.parse({ type: "PERSON", displayName: "Existing One" }),
        contact: contactSchema.parse({ name: "E", email: "existing@example.com" }),
      });
      const preview = await prepareImport(tx, manager, [
        row({ display_name: "New A", email: "newa@example.com" }),
        row({ display_name: "Dup By Email", email: "existing@example.com" }),
        row({ display_name: "Dup In File", email: "newa@example.com" }),
        row({ display_name: "Bad", email: "not-an-email" }),
        row({
          display_name: "New B",
          phone: "082 555 0101",
          property_address: "5 Import St",
          monthly_fee_rand: "400",
        }),
      ]);
      expect(preview.create.map((r) => r.customer.displayName)).toEqual(["New A", "New B"]);
      expect(preview.duplicates.map((d) => d.line)).toEqual([3, 4]);
      expect(preview.errors.map((e) => e.line)).toEqual([5]);
    });
  });

  it("also catches an existing phone and the same name and address", async () => {
    await withRollback(async (tx) => {
      await createCustomer(tx, manager, {
        customer: customerSchema.parse({ type: "PERSON", displayName: "Phone Owner" }),
        contact: contactSchema.parse({ name: "P", phone: "082 555 0199" }),
        property: undefined,
      });
      const preview = await prepareImport(tx, manager, [
        row({ display_name: "Other Name", phone: "0825550199" }),
        row({ display_name: "Same Twice", email: "same1@example.com", property_address: "9 A St" }),
        row({ display_name: "same twice", email: "same2@example.com", property_address: "9 a st" }),
        row({ display_name: "Same Twice", phone: "0825550188", property_address: "10 B St" }),
      ]);
      expect(preview.duplicates.map((d) => [d.line, d.reason])).toEqual([
        [2, "phone already used"],
        [4, "same name and address"],
      ]);
      expect(preview.create.map((r) => r.line)).toEqual([3, 5]);
    });
  });

  it("commits only the good rows, in one go, and audits counts only", async () => {
    await withRollback(async (tx) => {
      const result = await commitImport(tx, manager, [
        row({
          display_name: "Commit A",
          email: "commita@example.com",
          property_address: "1 Commit Rd",
          monthly_fee_rand: "850",
        }),
        row({ display_name: "Commit B", phone: "0825550102" }),
        row({ display_name: "Broken", email: "x" }),
      ]);
      expect(result).toEqual({ created: 2, duplicates: 0, errors: 1 });
      const made = await tx.customer.findMany({
        where: { displayName: { startsWith: "Commit " } },
        include: { contacts: true, properties: true },
        orderBy: { displayName: "asc" },
      });
      expect(made).toHaveLength(2);
      expect(made[0]?.properties[0]?.agreedMonthlyFeeCents).toBe(85000);
      expect(made[1]?.contacts[0]?.phone).toBe("+27825550102");

      const audit = await tx.auditLog.findFirst({ where: { action: "customer.imported" } });
      expect(audit?.after).toEqual({ created: 2, duplicates: 0, errors: 1 });
      expect(JSON.stringify(audit)).not.toContain("Commit A");
    });
  });

  it("writes no personal values to the audit log and every new customer has a contact", async () => {
    await withRollback(async (tx) => {
      await commitImport(tx, manager, [
        row({
          display_name: "Zelda Privacy",
          contact_name: "Zelda Contact",
          email: "zelda.privacy@example.com",
          phone: "082 555 0177",
          property_address: "77 Secret Lane",
          notes: "private note",
        }),
      ]);
      const entries = await tx.auditLog.findMany({ where: { actorId: manager.id } });
      expect(entries.map((e) => e.action)).toEqual(["customer.imported"]);
      const text = JSON.stringify(entries);
      for (const secret of [
        "Zelda",
        "zelda.privacy",
        "555 0177",
        "+2782555",
        "Secret Lane",
        "private note",
      ]) {
        expect(text).not.toContain(secret);
      }
      const orphans = await tx.customer.count({
        where: { displayName: "Zelda Privacy", contacts: { none: {} } },
      });
      expect(orphans).toBe(0);
    });
  });

  it("refuses crew before any read or write", async () => {
    await withRollback(async (tx) => {
      const crew: Actor = { id: randomUUID(), role: "CREW" };
      const before = await tx.customer.count();
      await expect(
        prepareImport(tx, crew, [row({ email: "c@example.com" })]),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        commitImport(tx, crew, [row({ email: "c@example.com" })]),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(await tx.customer.count()).toBe(before);
      expect(await tx.auditLog.count({ where: { action: "customer.imported" } })).toBe(0);
    });
  });
});
