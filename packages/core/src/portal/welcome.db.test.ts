import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import type { PortalScope } from "./scope";
import { asPortal, addPortalContact, makeClient, scopeOf } from "./test-helpers";
import { WELCOME_GONE, completeWelcome, getWelcomeStep } from "./welcome";
import type { WelcomeInput } from "./welcome-schema";

const input = (contactId: string, over: Partial<WelcomeInput> = {}): WelcomeInput => ({
  contactId,
  name: "ZZ E2E Welcomed Person",
  phone: "+27821112233",
  billingLine1: "ZZ 9 Billing Road",
  billingLine2: null,
  billingSuburb: "ZZ Billing Suburb",
  billingCity: "ZZ Billing City",
  billingPostalCode: "7441",
  consent: "on",
  ...over,
});

/** A scope someone built by hand with extra contacts: the statements must still refuse what is not theirs. */
function forged(
  scope: PortalScope,
  extra: { id: string; customerId: string; name: string }[],
): PortalScope {
  return {
    ...scope,
    contacts: [...scope.contacts, ...extra.map((c) => ({ ...c, welcomed: false }))],
  } as PortalScope;
}

describe.skipIf(!dbTestsEnabled)("the portal welcome, run as ace_portal", () => {
  it("shows one contact at a time and records the welcome on that contact and its own customer only", async () => {
    await withRollback(async (tx) => {
      const email = `${randomUUID()}@example.com`;
      const agency = await makeClient(tx, { email, welcomed: false });
      const complex = await makeClient(tx, { managedById: agency.customerId });
      await addPortalContact(tx, complex.customerId, { email, welcomed: false });
      const complexBefore = await tx.customer.findUniqueOrThrow({
        where: { id: complex.customerId },
      });

      const step = await asPortal(tx, async () => getWelcomeStep(tx, await scopeOf(tx, email)));
      expect(step?.remaining).toBe(2);
      expect(step?.email).toBe(email);
      const stepCustomer =
        step?.contactId === agency.contactId ? agency.customerId : complex.customerId;
      const otherCustomer =
        stepCustomer === agency.customerId ? complex.customerId : agency.customerId;

      await asPortal(tx, async () =>
        completeWelcome(tx, await scopeOf(tx, email), input(step!.contactId)),
      );

      const contact = await tx.contact.findUniqueOrThrow({ where: { id: step!.contactId } });
      expect(contact).toMatchObject({ name: "ZZ E2E Welcomed Person", phone: "+27821112233" });
      expect(contact.portalWelcomedAt).toBeInstanceOf(Date);
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: stepCustomer } });
      expect(customer).toMatchObject({
        billingLine1: "ZZ 9 Billing Road",
        billingSuburb: "ZZ Billing Suburb",
        billingCity: "ZZ Billing City",
        billingPostalCode: "7441",
        consentSource: "portal",
      });
      expect(customer.consentAt).toBeInstanceOf(Date);
      const other = await tx.customer.findUniqueOrThrow({ where: { id: otherCustomer } });
      // Both made-up customers start with no billing address and no consent; the other one is untouched.
      expect(complexBefore.billingLine1).toBeNull();
      expect(other.billingLine1).toBeNull();
      expect(other.consentSource).toBeNull();
      expect(other.consentAt).toBeNull();

      const audit = await tx.auditLog.findMany({
        where: { entityId: stepCustomer, action: "customer.portal_welcomed" },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actorType: "CUSTOMER",
        actorId: stepCustomer,
        ip: null,
        userAgent: null,
      });
      const after = audit[0]?.after as {
        contactId: string;
        changed: string[];
        consentRecorded: boolean;
      };
      expect(after.contactId).toBe(step!.contactId);
      expect(after.changed).toEqual(expect.arrayContaining(["name", "phone", "billingLine1"]));
      expect(after.consentRecorded).toBe(true);
      const text = JSON.stringify(audit);
      for (const typed of ["ZZ E2E Welcomed Person", "+27821112233", "ZZ 9 Billing Road", email]) {
        expect(text).not.toContain(typed);
      }

      const next = await asPortal(tx, async () => getWelcomeStep(tx, await scopeOf(tx, email)));
      expect(next?.remaining).toBe(1);
      expect(next?.contactId).not.toBe(step!.contactId);
      await asPortal(tx, async () =>
        completeWelcome(tx, await scopeOf(tx, email), input(next!.contactId)),
      );
      expect(
        await asPortal(tx, async () => getWelcomeStep(tx, await scopeOf(tx, email))),
      ).toBeNull();
    });
  });

  it("keeps an earlier consent, and refuses another person's contact or a step already done", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx, { welcomed: false });
      const stranger = await makeClient(tx, { welcomed: false });
      const earlier = new Date("2026-01-15T08:00:00.000Z");
      await tx.customer.update({
        where: { id: client.customerId },
        data: { consentAt: earlier, consentSource: "staff" },
      });
      const scope = await scopeOf(tx, client.email);

      await expect(
        asPortal(tx, () => completeWelcome(tx, scope, input(stranger.contactId))),
      ).rejects.toThrow(WELCOME_GONE);
      expect(
        (await tx.contact.findUniqueOrThrow({ where: { id: stranger.contactId } }))
          .portalWelcomedAt,
      ).toBeNull();

      await asPortal(tx, () => completeWelcome(tx, scope, input(client.contactId)));
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: client.customerId } });
      expect(customer.consentAt).toEqual(earlier);
      expect(customer.consentSource).toBe("staff");
      const audit = await tx.auditLog.findMany({
        where: { entityId: client.customerId, action: "customer.portal_welcomed" },
      });
      expect((audit[0]?.after as { consentRecorded: boolean }).consentRecorded).toBe(false);

      // The old scope still lists the contact as not welcomed; the check under the lock refuses anyway.
      await expect(
        asPortal(tx, () => completeWelcome(tx, scope, input(client.contactId))),
      ).rejects.toThrow(WELCOME_GONE);
    });
  });

  it("never updates a contact or customer that is not the signed-in person's, even with a hand-made scope", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx, { welcomed: false });
      const stranger = await makeClient(tx, { welcomed: false, name: "ZZ E2E Stranger Co" });
      // A colleague at the person's OWN customer, with another email: also not theirs.
      const colleague = await addPortalContact(tx, client.customerId, { welcomed: false });
      const scope = await scopeOf(tx, client.email);
      const strangerBefore = await tx.customer.findUniqueOrThrow({
        where: { id: stranger.customerId },
      });
      const strangerContactBefore = await tx.contact.findUniqueOrThrow({
        where: { id: stranger.contactId },
      });

      // The id is not in the scope.
      await expect(
        asPortal(tx, () => completeWelcome(tx, scope, input(stranger.contactId))),
      ).rejects.toThrow(WELCOME_GONE);
      await expect(
        asPortal(tx, () => completeWelcome(tx, scope, input(colleague.contactId))),
      ).rejects.toThrow(WELCOME_GONE);
      await expect(
        asPortal(tx, () => completeWelcome(tx, scope, input(randomUUID()))),
      ).rejects.toThrow(WELCOME_GONE);

      // The id is (wrongly) in the scope: the statements still check the email on the contact row.
      const fake = forged(scope, [
        { id: stranger.contactId, customerId: stranger.customerId, name: "x" },
        { id: colleague.contactId, customerId: client.customerId, name: "x" },
      ]);
      await expect(
        asPortal(tx, () => completeWelcome(tx, fake, input(stranger.contactId))),
      ).rejects.toThrow(WELCOME_GONE);
      await expect(
        asPortal(tx, () => completeWelcome(tx, fake, input(colleague.contactId))),
      ).rejects.toThrow(WELCOME_GONE);

      expect(await tx.customer.findUniqueOrThrow({ where: { id: stranger.customerId } })).toEqual(
        strangerBefore,
      );
      expect(await tx.contact.findUniqueOrThrow({ where: { id: stranger.contactId } })).toEqual(
        strangerContactBefore,
      );
      const colleagueRow = await tx.contact.findUniqueOrThrow({
        where: { id: colleague.contactId },
      });
      expect(colleagueRow.portalWelcomedAt).toBeNull();
      expect(colleagueRow.phone).toBeNull();
      const own = await tx.customer.findUniqueOrThrow({ where: { id: client.customerId } });
      expect(own.billingLine1).toBeNull();
      expect(own.consentAt).toBeNull();
      expect(
        await tx.auditLog.count({
          where: {
            entityId: { in: [client.customerId, stranger.customerId] },
            action: "customer.portal_welcomed",
          },
        }),
      ).toBe(0);
    });
  });

  it("refuses when access was removed or the customer archived after the page was loaded", async () => {
    await withRollback(async (tx) => {
      const removed = await makeClient(tx, { welcomed: false });
      const archived = await makeClient(tx, { welcomed: false });
      const removedScope = await scopeOf(tx, removed.email);
      const archivedScope = await scopeOf(tx, archived.email);
      await tx.contact.update({ where: { id: removed.contactId }, data: { portalAccess: false } });
      await tx.customer.update({
        where: { id: archived.customerId },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });
      await expect(
        asPortal(tx, () => completeWelcome(tx, removedScope, input(removed.contactId))),
      ).rejects.toThrow(WELCOME_GONE);
      await expect(
        asPortal(tx, () => completeWelcome(tx, archivedScope, input(archived.contactId))),
      ).rejects.toThrow(WELCOME_GONE);
      for (const c of [removed, archived]) {
        const row = await tx.contact.findUniqueOrThrow({ where: { id: c.contactId } });
        expect(row.portalWelcomedAt).toBeNull();
        expect(
          (await tx.customer.findUniqueOrThrow({ where: { id: c.customerId } })).billingLine1,
        ).toBeNull();
      }
    });
  });

  it("clears the phone and billing lines when they are left blank, and still welcomes", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx, { welcomed: false });
      await tx.contact.update({ where: { id: client.contactId }, data: { phone: "+27829998877" } });
      await tx.customer.update({
        where: { id: client.customerId },
        data: { billingLine1: "ZZ Old Line", billingCity: "ZZ Old City" },
      });
      const scope = await scopeOf(tx, client.email);
      await asPortal(tx, () =>
        completeWelcome(
          tx,
          scope,
          input(client.contactId, {
            phone: null,
            billingLine1: null,
            billingSuburb: null,
            billingCity: null,
            billingPostalCode: null,
          }),
        ),
      );
      const contact = await tx.contact.findUniqueOrThrow({ where: { id: client.contactId } });
      expect(contact.phone).toBeNull();
      expect(contact.portalWelcomedAt).toBeInstanceOf(Date);
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: client.customerId } });
      expect(customer.billingLine1).toBeNull();
      expect(customer.billingCity).toBeNull();
      expect(
        await asPortal(tx, async () => getWelcomeStep(tx, await scopeOf(tx, client.email))),
      ).toBeNull();
    });
  });
});
