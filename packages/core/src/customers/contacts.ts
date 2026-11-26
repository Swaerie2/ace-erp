import { endPortalSignIns } from "../portal/end-sign-ins";
import { assertRole, DomainError, MANAGEMENT, type Actor } from "./access";
import { contactData } from "./mappers";
import type { ContactInput } from "./schemas";
import {
  changedFields,
  findEditableCustomer,
  lockCustomer,
  logCustomerEvent,
  requireEditableCustomer,
  type Store,
} from "./store";

export async function addContact(
  store: Store,
  actor: Actor,
  customerId: string,
  input: ContactInput,
) {
  assertRole(actor, MANAGEMENT);
  await requireEditableCustomer(store, customerId);
  const created = await store.contact.create({
    data: { customerId, ...contactData(input) },
    select: { id: true },
  });
  await logCustomerEvent(store, actor, "customer.contact_added", customerId, {
    contactId: created.id,
  });
  return created;
}

export async function updateContact(
  store: Store,
  actor: Actor,
  contactId: string,
  input: ContactInput,
) {
  assertRole(actor, MANAGEMENT);
  const existing = await store.contact.findUnique({ where: { id: contactId } });
  if (!existing) throw new DomainError("That contact could not be found.");
  await findEditableCustomer(store, existing.customerId);
  const data = contactData(input);
  const changed = changedFields(existing, data);
  // A save that changes nothing writes nothing: no lock, no update, no audit line.
  if (changed.length === 0) return;
  // The customer lock comes BEFORE the old email's sign-ins are ended: a portal sign-in share-locks the
  // same row before it writes a code or a session, so one that got there first has committed by then.
  await lockCustomer(store, existing.customerId);
  // Re-read at the lock: the email whose sign-ins end must be the one being replaced now.
  const current = await store.contact.findUnique({
    where: { id: contactId },
    select: { email: true },
  });
  if (!current) throw new DomainError("That contact could not be found.");
  await store.contact.update({ where: { id: contactId }, data });
  // The old email's portal sign-ins end (unless another contact with it still has access).
  if (current.email && current.email !== data.email) {
    await endPortalSignIns(store, [current.email], [contactId]);
  }
  await logCustomerEvent(store, actor, "customer.contact_updated", existing.customerId, {
    contactId,
    changed,
  });
}

export async function removeContact(store: Store, actor: Actor, contactId: string) {
  assertRole(actor, MANAGEMENT);
  const existing = await store.contact.findUnique({ where: { id: contactId } });
  if (!existing) throw new DomainError("That contact could not be found.");
  await requireEditableCustomer(store, existing.customerId);
  // requireEditableCustomer has just locked the customer row until this transaction ends. Without
  // that lock, two people removing two different contacts at once could both count 2 and both
  // delete, leaving none. The second removal waits there, then counts the committed result.
  const count = await store.contact.count({ where: { customerId: existing.customerId } });
  if (count <= 1) throw new DomainError("A customer needs at least one contact.");
  // Re-read at the lock: the email whose sign-ins end must be the one on the row being deleted.
  const current = await store.contact.findUnique({
    where: { id: contactId },
    select: { email: true },
  });
  if (!current) throw new DomainError("That contact could not be found.");
  await store.contact.delete({ where: { id: contactId } });
  // Its portal sign-ins end (unless another contact with the email still has access). The customer lock
  // above is taken first, for the same reason as in updateContact.
  if (current.email) await endPortalSignIns(store, [current.email], [contactId]);
  await logCustomerEvent(store, actor, "customer.contact_removed", existing.customerId, {
    contactId,
  });
}
