import { randomUUID } from "node:crypto";
import { createCustomer } from "../customers/customers";
import { contactSchema, customerSchema, propertySchema } from "../customers/schemas";
import type { Prisma } from "../generated/prisma/client";
import { createQuote } from "../quotes/drafts";
import { issueQuote } from "../quotes/issue";
import type { DraftInput } from "../quotes/schemas";
import { fillDraft, manager, token } from "../quotes/test-helpers";
import { loadPortalScope, type PortalScope } from "./scope";
import { generateSessionToken, hashSessionToken, newSessionTimes } from "./session-token";
import type { SignInCodeMessage } from "./signin";

type Tx = Prisma.TransactionClient;

export const AS_PORTAL = `SET LOCAL ROLE "ace_portal"`;

/** Runs `fn` as the portal's own database role, then switches back. */
export async function asPortal<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  await tx.$executeRawUnsafe(AS_PORTAL);
  try {
    return await fn();
  } finally {
    // After a refused statement the transaction is already aborted; the original error matters more.
    await tx.$executeRawUnsafe("RESET ROLE").catch(() => undefined);
  }
}

export type MadeClient = {
  customerId: string;
  propertyId: string;
  contactId: string;
  email: string;
  name: string;
};

/**
 * A made-up company customer with one property and one contact who receives quotes (portal access on and
 * welcomed by default; with `access: false` the contact was never invited).
 */
export async function makeClient(
  tx: Tx,
  opts: {
    name?: string;
    managedById?: string;
    access?: boolean;
    welcomed?: boolean;
    email?: string;
  } = {},
): Promise<MadeClient> {
  const email = opts.email ?? `${randomUUID()}@example.com`;
  const name = opts.name ?? `ZZ E2E Client ${token()}`;
  const access = opts.access ?? true;
  const { id } = await createCustomer(tx, manager, {
    customer: customerSchema.parse({ type: "COMPANY", displayName: name, status: "ACTIVE" }),
    contact: contactSchema.parse({ name: `ZZ E2E Person ${token()}`, email, receivesQuotes: "on" }),
    property: propertySchema.parse({
      label: "Main",
      addressLine1: "1 Portal Street",
      suburb: "Testville",
    }),
  });
  const contact = await tx.contact.findFirstOrThrow({
    where: { customerId: id },
    select: { id: true },
  });
  const property = await tx.property.findFirstOrThrow({
    where: { customerId: id },
    select: { id: true },
  });
  await tx.contact.update({
    where: { id: contact.id },
    data: {
      portalAccess: access,
      portalInvitedAt: access ? new Date() : null,
      portalWelcomedAt: access && (opts.welcomed ?? true) ? new Date() : null,
    },
  });
  if (opts.managedById) {
    await tx.customer.update({ where: { id }, data: { managedById: opts.managedById } });
  }
  return { customerId: id, propertyId: property.id, contactId: contact.id, email, name };
}

/** Another contact on an existing customer. */
export async function addPortalContact(
  tx: Tx,
  customerId: string,
  opts: {
    email?: string;
    access?: boolean;
    welcomed?: boolean;
    receivesQuotes?: boolean;
    name?: string;
  } = {},
): Promise<{ contactId: string; email: string }> {
  const email = opts.email ?? `${randomUUID()}@example.com`;
  const access = opts.access ?? true;
  const c = await tx.contact.create({
    data: {
      customerId,
      name: opts.name ?? `ZZ E2E Person ${token()}`,
      email,
      receivesQuotes: opts.receivesQuotes ?? true,
      portalAccess: access,
      portalInvitedAt: access ? new Date() : null,
      portalWelcomedAt: access && (opts.welcomed ?? true) ? new Date() : null,
    },
    select: { id: true },
  });
  return { contactId: c.id, email };
}

/** Issues a quote (one monthly line by default) for a customer's property. Takes about 10 seconds. */
export async function issueFor(
  tx: Tx,
  c: { customerId: string; propertyId: string },
  draft?: Partial<DraftInput>,
): Promise<string> {
  const { id } = await createQuote(tx, manager, {
    customerId: c.customerId,
    propertyId: c.propertyId,
  });
  await fillDraft(tx, id, draft);
  await issueQuote(tx, manager, id);
  return id;
}

export async function scopeOf(tx: Tx, email: string): Promise<PortalScope> {
  const scope = await loadPortalScope(tx, email);
  if (!scope) throw new Error("Expected the email to have a portal scope.");
  return scope;
}

/** A live session row for the email; returns the raw cookie value. */
export async function makeSession(tx: Tx, email: string, now: Date = new Date()): Promise<string> {
  const raw = generateSessionToken();
  await tx.portalSession.create({
    data: { tokenHash: hashSessionToken(raw), email, createdAt: now, ...newSessionTimes(now) },
  });
  return raw;
}

/** Collects the sign-in emails instead of sending them. */
export function mailbox() {
  const sent: SignInCodeMessage[] = [];
  return {
    sent,
    send: async (message: SignInCodeMessage) => {
      sent.push(message);
    },
  };
}
