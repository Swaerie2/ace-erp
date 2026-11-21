import { randomInt, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { DomainError, ForbiddenError, type Actor } from "./access";
import { addContact, updateContact } from "./contacts";
import { archiveCustomer, createCustomer, getCustomer, updateCustomer } from "./customers";
import { formatCustomerNumber } from "./number";
import { anonymiseCustomer, exportCustomerData } from "./privacy";
import { addProperty, updateProperty } from "./properties";
import { contactSchema, customerSchema, propertySchema } from "./schemas";

const owner: Actor = { id: randomUUID(), role: "OWNER" };
const manager: Actor = { id: randomUUID(), role: "MANAGER" };
const crew: Actor = { id: randomUUID(), role: "CREW" };

/** A made-up value nobody could have by accident, so "not found" assertions mean something. */
const tag = (label: string) => `${label}-${randomUUID().slice(0, 18)}`;

/** A made-up South African mobile number: typed form, stored form, and the bare 9 digits. */
function fakePhone() {
  const rest = String(randomInt(0, 10_000_000)).padStart(7, "0");
  return {
    typed: `082 ${rest.slice(0, 3)} ${rest.slice(3)}`,
    stored: `+2782${rest}`,
    tail: `82${rest}`,
  };
}

/** Every personal value used by one made-up customer (names, emails, phones, addresses, notes...). */
function fakePerson() {
  const v = {
    displayName: tag("name"),
    companyName: tag("company"),
    registrationNumber: tag("reg"),
    billingLine1: tag("bill1"),
    billingLine2: tag("bill2"),
    billingSuburb: tag("billsub"),
    billingCity: tag("billcity"),
    sourceNote: tag("source"),
    notes: tag("note"),
    consentSource: tag("consentsrc"),
    consentNote: tag("consentnote"),
    contactName: tag("contact"),
    contactRole: tag("role"),
    contactEmail: `${randomUUID()}@example.com`,
    phoneA: fakePhone(),
    contact2Name: tag("contact2"),
    contact2Email: `${randomUUID()}@example.com`,
    phoneB: fakePhone(),
    label: tag("label"),
    addressLine1: tag("street"),
    addressLine2: tag("street2"),
    suburb: tag("suburb"),
    city: tag("city"),
    mapUrl: `https://maps.example.com/${randomUUID()}`,
    accessNotes: tag("access"),
    terrainNotes: tag("terrain"),
    label2: tag("label2"),
    address2: tag("street3"),
    access2: tag("access2"),
    updatedNote: tag("updatednote"),
  };
  // Everything that must be gone after anonymising (phones are checked by their bare digits too).
  const secrets = [
    v.displayName,
    v.companyName,
    v.registrationNumber,
    v.billingLine1,
    v.billingLine2,
    v.billingSuburb,
    v.billingCity,
    v.sourceNote,
    v.notes,
    v.consentSource,
    v.consentNote,
    v.contactName,
    v.contactRole,
    v.contactEmail,
    v.phoneA.stored,
    v.phoneA.tail,
    v.contact2Name,
    v.contact2Email,
    v.phoneB.stored,
    v.phoneB.tail,
    v.label,
    v.addressLine1,
    v.addressLine2,
    v.suburb,
    v.city,
    v.mapUrl,
    v.accessNotes,
    v.terrainNotes,
    v.label2,
    v.address2,
    v.access2,
    v.updatedNote,
  ];
  return { v, secrets };
}

type Tx = Parameters<typeof createCustomer>[0];

/** Creates a customer with every personal column filled, a second contact and property, and an edit. */
async function makeFull(tx: Tx) {
  const { v, secrets } = fakePerson();
  const customerInput = {
    type: "COMPANY",
    displayName: v.displayName,
    companyName: v.companyName,
    registrationNumber: v.registrationNumber,
    billingLine1: v.billingLine1,
    billingLine2: v.billingLine2,
    billingSuburb: v.billingSuburb,
    billingCity: v.billingCity,
    billingPostalCode: "7441",
    source: "REFERRAL",
    sourceNote: v.sourceNote,
    notes: v.notes,
    consentGiven: "on",
    consentSource: v.consentSource,
    consentNote: v.consentNote,
  };
  const { id, number } = await createCustomer(tx, owner, {
    customer: customerSchema.parse(customerInput),
    contact: contactSchema.parse({
      name: v.contactName,
      role: v.contactRole,
      email: v.contactEmail,
      phone: v.phoneA.typed,
      portalAccess: "on",
    }),
    property: propertySchema.parse({
      label: v.label,
      addressLine1: v.addressLine1,
      addressLine2: v.addressLine2,
      suburb: v.suburb,
      city: v.city,
      postalCode: "7441",
      mapUrl: v.mapUrl,
      accessNotes: v.accessNotes,
      terrainNotes: v.terrainNotes,
    }),
  });
  await addContact(
    tx,
    owner,
    id,
    contactSchema.parse({ name: v.contact2Name, email: v.contact2Email, phone: v.phoneB.typed }),
  );
  await addProperty(
    tx,
    owner,
    id,
    propertySchema.parse({
      label: v.label2,
      addressLine1: v.address2,
      accessNotes: v.access2,
    }),
  );
  // A later edit, so the audit log holds a customer.updated row from before anonymising.
  await updateCustomer(
    tx,
    owner,
    id,
    customerSchema.parse({ ...customerInput, notes: v.updatedNote }),
  );
  return { id, number, v, secrets };
}

const leaks = (text: string, secrets: string[]) => secrets.filter((s) => text.includes(s));

describe.skipIf(!dbTestsEnabled)("customer privacy tools", () => {
  it("exports everything for the owner, including contacts and properties, and audits it", async () => {
    await withRollback(async (tx) => {
      const { id, number, v } = await makeFull(tx);
      const data = await exportCustomerData(tx, owner, id);

      expect(data.customer.number).toBe(number);
      expect(data.customer.displayName).toBe(v.displayName);
      expect(data.customer.contacts.map((c) => c.email).sort()).toEqual(
        [v.contactEmail, v.contact2Email].sort(),
      );
      expect(data.customer.contacts.map((c) => c.phone)).toEqual(
        expect.arrayContaining([v.phoneA.stored, v.phoneB.stored]),
      );
      expect(data.customer.properties.map((p) => p.addressLine1).sort()).toEqual(
        [v.addressLine1, v.address2].sort(),
      );
      expect(data.customer.properties.map((p) => p.accessNotes)).toEqual(
        expect.arrayContaining([v.accessNotes, v.access2]),
      );
      expect(Number.isNaN(Date.parse(data.exportedAt))).toBe(false);

      // The activity list names what happened and when, never the values.
      const actions = data.activity.map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(["customer.created", "customer.updated"]));
      expect(JSON.stringify(data.activity)).not.toContain(v.updatedNote);

      const audited = await tx.auditLog.findMany({
        where: { entityId: id, action: "customer.exported" },
      });
      expect(audited).toHaveLength(1);
      expect(audited[0]?.actorId).toBe(owner.id);
    });
  });

  it("never includes another customer's data in an export", async () => {
    await withRollback(async (tx) => {
      const mine = await makeFull(tx);
      const other = await makeFull(tx);
      const text = JSON.stringify(await exportCustomerData(tx, owner, mine.id));
      expect(leaks(text, other.secrets)).toEqual([]);
      expect(text).not.toContain(other.id);
      expect(text).toContain(mine.v.displayName);
    });
  });

  it("refuses an export for an unknown customer", async () => {
    await withRollback(async (tx) => {
      await expect(exportCustomerData(tx, owner, randomUUID())).rejects.toBeInstanceOf(DomainError);
    });
  });

  it("refuses managers and crew, before looking at anything, and changes nothing", async () => {
    await withRollback(async (tx) => {
      const { id, number, v } = await makeFull(tx);
      const confirm = formatCustomerNumber(number);
      for (const actor of [manager, crew]) {
        await expect(exportCustomerData(tx, actor, id)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(anonymiseCustomer(tx, actor, id, confirm)).rejects.toBeInstanceOf(
          ForbiddenError,
        );
        // The role check comes first, so an unknown id does not turn into a "not found".
        await expect(exportCustomerData(tx, actor, randomUUID())).rejects.toBeInstanceOf(
          ForbiddenError,
        );
        await expect(anonymiseCustomer(tx, actor, randomUUID(), confirm)).rejects.toBeInstanceOf(
          ForbiddenError,
        );
      }
      const after = await tx.customer.findUnique({ where: { id } });
      expect(after?.anonymisedAt).toBeNull();
      expect(after?.displayName).toBe(v.displayName);
      const events = await tx.auditLog.findMany({
        where: { entityId: id, action: { in: ["customer.exported", "customer.anonymised"] } },
      });
      expect(events).toHaveLength(0);
    });
  });

  it("needs the customer number typed correctly, and an existing customer", async () => {
    await withRollback(async (tx) => {
      const { id, number, v } = await makeFull(tx);
      for (const wrong of ["C-9999999", "", "not a number", formatCustomerNumber(number + 1)]) {
        await expect(anonymiseCustomer(tx, owner, id, wrong)).rejects.toBeInstanceOf(DomainError);
      }
      await expect(
        anonymiseCustomer(tx, owner, randomUUID(), formatCustomerNumber(number)),
      ).rejects.toBeInstanceOf(DomainError);
      // Nothing was touched by the refused attempts.
      const after = await tx.customer.findUnique({ where: { id } });
      expect(after?.anonymisedAt).toBeNull();
      expect(after?.displayName).toBe(v.displayName);
    });
  });

  it("removes every personal detail, keeps the row and the money, and locks editing", async () => {
    await withRollback(async (tx) => {
      const { id, number, secrets, v } = await makeFull(tx);

      // Sanity: before anonymising, the made-up values really are stored (so the checks below bite).
      const beforeCustomer = JSON.stringify(
        await tx.customer.findUnique({
          where: { id },
          include: { contacts: true, properties: true },
        }),
      );
      const beforeAudit = JSON.stringify(await tx.auditLog.findMany({ where: { entityId: id } }));
      // (the first note was replaced by the edit, so it is the only one not stored any more)
      const stored = secrets.filter((s) => beforeCustomer.includes(s));
      expect(stored).toHaveLength(secrets.length - 1);
      expect(stored).not.toContain(v.notes);
      expect(stored).toContain(v.updatedNote);
      expect(beforeAudit).toContain("customer.created");
      expect(beforeAudit).toContain("customer.updated");
      expect(leaks(beforeAudit, secrets)).toEqual([]);

      await anonymiseCustomer(tx, owner, id, formatCustomerNumber(number));

      const customerRow = await tx.customer.findUnique({ where: { id } });
      const contactRows = await tx.contact.findMany({ where: { customerId: id } });
      const propertyRows = await tx.property.findMany({ where: { customerId: id } });
      const auditRows = await tx.auditLog.findMany({ where: { entityId: id } });
      const withChildren = await tx.customer.findUnique({
        where: { id },
        include: { contacts: true, properties: true },
      });
      const places = {
        customer: customerRow,
        contacts: contactRows,
        properties: propertyRows,
        audit: auditRows,
        everything: withChildren,
      };
      for (const [where, rows] of Object.entries(places)) {
        expect(leaks(JSON.stringify(rows), secrets), `personal data left in ${where}`).toEqual([]);
      }

      // The record and its number are kept.
      expect(customerRow?.number).toBe(number);
      expect(customerRow?.anonymisedAt).not.toBeNull();
      expect(customerRow?.status).toBe("ARCHIVED");
      expect(customerRow?.archivedAt).not.toBeNull();
      expect(customerRow?.statusBeforeArchive).toBeNull();
      expect(contactRows).toHaveLength(2);
      expect(propertyRows).toHaveLength(2);

      // Every personal column is empty or replaced, and portal login is switched off.
      expect(customerRow).toMatchObject({
        displayName: "Anonymised customer",
        companyName: null,
        registrationNumber: null,
        billingLine1: null,
        billingLine2: null,
        billingSuburb: null,
        billingCity: null,
        billingPostalCode: null,
        sourceNote: null,
        notes: null,
        consentAt: null,
        consentSource: null,
        consentNote: null,
      });
      for (const c of contactRows) {
        expect(c).toMatchObject({
          name: "Anonymised contact",
          role: null,
          email: null,
          phone: null,
          portalAccess: false,
        });
      }
      for (const p of propertyRows) {
        expect(p).toMatchObject({
          label: "Anonymised property",
          addressLine1: "Anonymised",
          addressLine2: null,
          suburb: null,
          city: null,
          postalCode: null,
          mapUrl: null,
          accessNotes: null,
          terrainNotes: null,
        });
      }

      // The old audit lines remain, plus one for the anonymising itself.
      const actions = auditRows.map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining(["customer.created", "customer.updated", "customer.anonymised"]),
      );
      expect(actions.filter((a) => a === "customer.anonymised")).toHaveLength(1);

      // Editing is locked, whichever way it is tried.
      const someContact = contactRows[0]!;
      const someProperty = propertyRows[0]!;
      const newContact = () =>
        contactSchema.parse({ name: tag("x"), email: `${randomUUID()}@example.com` });
      const newProperty = () => propertySchema.parse({ label: tag("x"), addressLine1: tag("x") });
      await expect(
        updateCustomer(
          tx,
          owner,
          id,
          customerSchema.parse({ type: "PERSON", displayName: tag("back") }),
        ),
      ).rejects.toBeInstanceOf(DomainError);
      await expect(archiveCustomer(tx, owner, id)).rejects.toBeInstanceOf(DomainError);
      await expect(addContact(tx, owner, id, newContact())).rejects.toBeInstanceOf(DomainError);
      await expect(updateContact(tx, owner, someContact.id, newContact())).rejects.toBeInstanceOf(
        DomainError,
      );
      await expect(addProperty(tx, owner, id, newProperty())).rejects.toBeInstanceOf(DomainError);
      await expect(
        updateProperty(tx, owner, someProperty.id, newProperty()),
      ).rejects.toBeInstanceOf(DomainError);

      // It cannot be done twice, and the scrubbed record can still be read and exported.
      await expect(
        anonymiseCustomer(tx, owner, id, formatCustomerNumber(number)),
      ).rejects.toBeInstanceOf(DomainError);
      expect(await getCustomer(tx, owner, id)).not.toBeNull();
      const exported = await exportCustomerData(tx, owner, id);
      expect(leaks(JSON.stringify(exported), secrets)).toEqual([]);
      expect(exported.customer.anonymisedAt).not.toBeNull();
      expect(exported.customer.displayName).not.toBe(v.displayName);
    });
  });

  it("also clears the free-text grass type, keeps lawn size and day, and a repeat call fails cleanly", async () => {
    await withRollback(async (tx) => {
      const grass = tag("grass");
      const { id, number } = await createCustomer(tx, owner, {
        customer: customerSchema.parse({ type: "PERSON", displayName: tag("name") }),
        contact: contactSchema.parse({
          name: tag("contact"),
          email: `${randomUUID()}@example.com`,
        }),
        property: propertySchema.parse({
          label: tag("label"),
          addressLine1: tag("street"),
          grassType: grass,
          lawnSizeSqm: "320",
          preferredDay: "Tuesday",
        }),
      });
      const confirm = formatCustomerNumber(number);
      await anonymiseCustomer(tx, owner, id, confirm);
      const first = await tx.customer.findUnique({ where: { id } });
      const props = await tx.property.findMany({ where: { customerId: id } });
      expect(props[0]?.grassType).toBeNull();
      expect(props[0]?.lawnSizeSqm).toBe(320);
      expect(props[0]?.preferredDay).toBe("Tuesday");

      await expect(anonymiseCustomer(tx, owner, id, confirm)).rejects.toThrow(
        "This customer is already anonymised.",
      );
      // The refused second call changed nothing: still scrubbed, same anonymising time, one audit line.
      const again = await tx.customer.findUnique({ where: { id } });
      expect(again?.anonymisedAt?.getTime()).toBe(first?.anonymisedAt?.getTime());
      expect(again?.displayName).toBe("Anonymised customer");
      expect(
        JSON.stringify(await tx.property.findMany({ where: { customerId: id } })),
      ).not.toContain(grass);
      expect(
        await tx.auditLog.count({ where: { entityId: id, action: "customer.anonymised" } }),
      ).toBe(1);
    });
  });
});
