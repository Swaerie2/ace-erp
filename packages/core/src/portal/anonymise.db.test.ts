import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCustomer } from "../customers/customers";
import { formatCustomerNumber } from "../customers/number";
import { anonymiseCustomer, exportCustomerData } from "../customers/privacy";
import { contactSchema, customerSchema } from "../customers/schemas";
import { manager, owner } from "../quotes/test-helpers";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { HIERARCHY_MESSAGES, setBillsToManager, setManagedBy } from "./hierarchy";

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];
const tok = () => randomUUID().replaceAll("-", "").slice(0, 10);

async function company(tx: Tx) {
  const { id, number } = await createCustomer(tx, manager, {
    customer: customerSchema.parse({
      type: "COMPANY",
      displayName: `ZZ E2E Company ${tok()}`,
      status: "ACTIVE",
    }),
    contact: contactSchema.parse({ name: "ZZ E2E Contact", email: `${randomUUID()}@example.com` }),
  });
  return { id, confirm: formatCustomerNumber(number) };
}

/** A contact with portal access and the dates a signed-in person would have. */
async function portalContact(tx: Tx, customerId: string, email: string) {
  const now = new Date();
  return tx.contact.create({
    data: {
      customerId,
      name: `ZZ E2E Person ${tok()}`,
      email,
      portalAccess: true,
      portalInvitedAt: now,
      portalWelcomedAt: now,
      lastSignedInAt: now,
    },
    select: { id: true },
  });
}

/** One live sign-in code and one session for the email. */
async function signInRows(tx: Tx, email: string) {
  const now = new Date();
  await tx.portalCode.create({
    data: {
      email,
      codeHash: "0".repeat(64),
      salt: "0".repeat(32),
      expiresAt: new Date(now.getTime() + 600_000),
    },
  });
  await tx.portalSession.create({
    data: {
      tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
      email,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 86_400_000),
      absoluteExpiresAt: new Date(now.getTime() + 2 * 86_400_000),
    },
  });
}

const signIns = async (tx: Tx, email: string) =>
  (await tx.portalCode.count({ where: { email } })) +
  (await tx.portalSession.count({ where: { email } }));

describe.skipIf(!dbTestsEnabled)("anonymise and the client portal", () => {
  it("refuses an agency that still manages complexes, and changes nothing", async () => {
    await withRollback(async (tx) => {
      const agency = await company(tx);
      const complex = await company(tx);
      await setManagedBy(tx, manager, complex.id, agency.id);
      await expect(anonymiseCustomer(tx, owner, agency.id, agency.confirm)).rejects.toThrow(
        HIERARCHY_MESSAGES.agencyStillManages,
      );
      expect(
        (await tx.customer.findUniqueOrThrow({ where: { id: agency.id } })).anonymisedAt,
      ).toBeNull();
    });
  });

  it("clears a complex's link when the complex is anonymised, so its agency can be anonymised next", async () => {
    await withRollback(async (tx) => {
      const agency = await company(tx);
      const complex = await company(tx);
      await setManagedBy(tx, manager, complex.id, agency.id);
      await setBillsToManager(tx, manager, complex.id, false);
      await anonymiseCustomer(tx, owner, complex.id, complex.confirm);
      expect(await tx.customer.findUniqueOrThrow({ where: { id: complex.id } })).toMatchObject({
        managedById: null,
        billsToManager: true,
      });
      await anonymiseCustomer(tx, owner, agency.id, agency.confirm);
      expect(
        (await tx.customer.findUniqueOrThrow({ where: { id: agency.id } })).anonymisedAt,
      ).not.toBeNull();
    });
  });

  it("ends the sign-ins of the customer's contacts, but not of an email that still has access elsewhere", async () => {
    await withRollback(async (tx) => {
      const leaving = await company(tx);
      const staying = await company(tx);
      const onlyHere = `${randomUUID()}@example.com`;
      const shared = `${randomUUID()}@example.com`;
      await portalContact(tx, leaving.id, onlyHere);
      await portalContact(tx, leaving.id, shared);
      await portalContact(tx, staying.id, shared);
      await signInRows(tx, onlyHere);
      await signInRows(tx, shared);
      expect(await signIns(tx, onlyHere)).toBe(2);

      await anonymiseCustomer(tx, owner, leaving.id, leaving.confirm);

      expect(await signIns(tx, onlyHere)).toBe(0);
      expect(await signIns(tx, shared)).toBe(2);
      const scrubbed = await tx.contact.findMany({ where: { customerId: leaving.id } });
      for (const c of scrubbed) {
        expect(c).toMatchObject({
          email: null,
          portalAccess: false,
          portalInvitedAt: null,
          portalWelcomedAt: null,
          lastSignedInAt: null,
        });
      }
    });
  });

  it("never puts sign-in codes or sessions in the customer data export", async () => {
    await withRollback(async (tx) => {
      const c = await company(tx);
      const email = `${randomUUID()}@example.com`;
      await portalContact(tx, c.id, email);
      await signInRows(tx, email);
      const text = JSON.stringify(await exportCustomerData(tx, owner, c.id));
      expect(text).toContain(email); // the contact itself is exported
      for (const secret of ["codeHash", "tokenHash", "salt", "portal_codes", "portal_sessions"]) {
        expect(text).not.toContain(secret);
      }
    });
  });
});
