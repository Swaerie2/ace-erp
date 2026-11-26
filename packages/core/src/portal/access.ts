import type { AuditParty } from "../audit";
import { assertRole, DomainError, MANAGEMENT, type Actor } from "../customers/access";
import {
  findEditableCustomer,
  lockCustomer,
  logCustomerEvent,
  logCustomerEventAs,
  type Store,
} from "../customers/store";
import type { Db } from "../db";
import type { Prisma } from "../generated/prisma/client";
import type { EmailMessage } from "./email/send";
import { welcomeEmail } from "./email/templates";
import { endPortalSignIns } from "./end-sign-ins";

const SYSTEM: AuditParty = { actorType: "SYSTEM" };

export const PORTAL_ACCESS_MESSAGES = {
  missing: "That contact could not be found.",
  noEmail: "Add an email address to this contact before inviting them to the portal.",
  archived: "Restore this customer before inviting anyone to the portal.",
} as const;

/** Someone who has just been given access and should get the welcome email. Server-side only. */
export type PortalInvite = { contactId: string; customerId: string; email: string; name: string };

export type TxRunner = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

export type InviteDeps = { send: (message: EmailMessage) => Promise<void>; signInUrl: string };

/** True when the customer can be given portal access: it exists, is not archived and not anonymised. */
async function customerOpenForAccess(
  store: Pick<Db, "customer">,
  customerId: string,
): Promise<boolean> {
  const customer = await store.customer.findUnique({
    where: { id: customerId },
    select: { status: true, anonymisedAt: true },
  });
  // An archived or anonymised customer is outside every portal scope: access would be pointless.
  return Boolean(customer && !customer.anonymisedAt && customer.status !== "ARCHIVED");
}

/**
 * After an acceptance has committed: the quote customer's contacts with an email, who receive quotes, have
 * no access and were never invited, get access and an invitation date. A contact whose access was removed
 * keeps its invitation date, so it is never silently given access again. Lock: the customer. Call inside
 * a transaction. Works under the `ace_portal` role (it names only granted columns).
 */
export async function grantAccessAfterAcceptance(
  store: Pick<Db, "quote" | "contact" | "customer" | "auditLog">,
  quoteId: string,
  now: Date = new Date(),
): Promise<PortalInvite[]> {
  const quote = await store.quote.findUnique({
    where: { id: quoteId },
    select: { customerId: true, status: true },
  });
  if (!quote || quote.status !== "ACCEPTED") return [];
  const candidates = {
    customerId: quote.customerId,
    email: { not: null },
    receivesQuotes: true,
    portalAccess: false,
    portalInvitedAt: null,
  } satisfies Prisma.ContactWhereInput;
  if ((await store.contact.count({ where: candidates })) === 0) return [];
  if (!(await customerOpenForAccess(store, quote.customerId))) return [];
  await lockCustomer(store, quote.customerId);
  // Re-check at the lock: the customer may have been archived in between.
  if (!(await customerOpenForAccess(store, quote.customerId))) return [];
  const contacts = await store.contact.findMany({
    where: candidates,
    orderBy: { id: "asc" },
    select: { id: true, name: true, email: true },
  });
  const invites: PortalInvite[] = [];
  for (const c of contacts) {
    if (!c.email) continue;
    const { count } = await store.contact.updateMany({
      where: { id: c.id, portalAccess: false, portalInvitedAt: null },
      data: { portalAccess: true, portalInvitedAt: now },
    });
    if (count !== 1) continue;
    invites.push({ contactId: c.id, customerId: quote.customerId, email: c.email, name: c.name });
    await logCustomerEventAs(store, SYSTEM, "customer.portal_access_granted", quote.customerId, {
      contactId: c.id,
      via: "acceptance",
    });
  }
  return invites;
}

/**
 * Sends the welcome email to each invite and notes the result in the audit log with fixed words only.
 * An email failure never throws: staff can press Invite to portal to send it again.
 */
export async function sendWelcomeEmails(
  store: Pick<Db, "auditLog">,
  invites: readonly PortalInvite[],
  deps: InviteDeps,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const invite of invites) {
    let ok = true;
    try {
      await deps.send(
        welcomeEmail({ to: invite.email, name: invite.name, signInUrl: deps.signInUrl }),
      );
    } catch {
      // Fixed words only: never the error (it may hold the address) or the address itself.
      console.error("A portal welcome email could not be sent.");
      ok = false;
    }
    if (ok) sent += 1;
    else failed += 1;
    await logCustomerEventAs(
      store,
      SYSTEM,
      ok ? "portal.invite_sent" : "portal.invite_failed",
      invite.customerId,
      { contactId: invite.contactId },
    );
  }
  return { sent, failed };
}

/**
 * The whole step after an acceptance commits: the grant in its own transaction (`run`), then the emails.
 * Called by the staff accept, the link accept and the portal accept, at the application layer.
 */
export async function grantPortalAccess(
  run: TxRunner,
  store: Pick<Db, "auditLog">,
  quoteId: string,
  deps: InviteDeps,
): Promise<{ sent: number; failed: number }> {
  const invites = await run((tx) => grantAccessAfterAcceptance(tx, quoteId));
  return sendWelcomeEmails(store, invites, deps);
}

async function readContact(store: Store, contactId: string) {
  const c = await store.contact.findUnique({
    where: { id: contactId },
    select: { id: true, customerId: true, name: true, email: true, portalAccess: true },
  });
  if (!c) throw new DomainError(PORTAL_ACCESS_MESSAGES.missing);
  return c;
}

/**
 * Staff "Invite to portal": gives access (again) and returns the invite so the caller can send the welcome
 * after the transaction commits. Owner or manager. Lock: the customer.
 */
export async function inviteContact(
  store: Store,
  actor: Actor,
  contactId: string,
  now: Date = new Date(),
): Promise<PortalInvite> {
  assertRole(actor, MANAGEMENT);
  const check = async () => {
    const c = await readContact(store, contactId);
    const email = c.email;
    if (!email) throw new DomainError(PORTAL_ACCESS_MESSAGES.noEmail);
    const customer = await findEditableCustomer(store, c.customerId);
    if (customer.status === "ARCHIVED") throw new DomainError(PORTAL_ACCESS_MESSAGES.archived);
    return { ...c, email };
  };
  const first = await check();
  await lockCustomer(store, first.customerId);
  const c = await check();
  await store.contact.update({
    where: { id: c.id },
    data: { portalAccess: true, portalInvitedAt: now },
    select: { id: true },
  });
  await logCustomerEvent(store, actor, "customer.portal_invited", c.customerId, {
    contactId: c.id,
  });
  return { contactId: c.id, customerId: c.customerId, email: c.email, name: c.name };
}

/**
 * Staff "Remove access": access off (the invitation date is kept), and that email's sessions and codes are
 * deleted unless another contact with the same email still has access. Owner or manager.
 * Lock: the customer, taken BEFORE the sessions and codes are deleted (sign-in share-locks the same row
 * before it writes a code or a session, so a sign-in that got there first has committed by then and its
 * new row is deleted too).
 */
export async function removeContactAccess(
  store: Store,
  actor: Actor,
  contactId: string,
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  const first = await readContact(store, contactId);
  if (!first.portalAccess) return;
  await findEditableCustomer(store, first.customerId);
  await lockCustomer(store, first.customerId);
  const c = await readContact(store, contactId);
  if (!c.portalAccess) return;
  await store.contact.update({
    where: { id: c.id },
    data: { portalAccess: false },
    select: { id: true },
  });
  const ended = c.email ? await endPortalSignIns(store, [c.email], [c.id]) : 0;
  await logCustomerEvent(store, actor, "customer.portal_access_removed", c.customerId, {
    contactId: c.id,
    signInsEnded: ended > 0,
  });
}
