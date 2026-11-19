import { assertRole, DomainError, MANAGEMENT, type Actor } from "./access";
import { propertyData } from "./mappers";
import type { PropertyInput } from "./schemas";
import {
  changedFields,
  findEditableCustomer,
  lockCustomer,
  logCustomerEvent,
  requireEditableCustomer,
  type Store,
} from "./store";

export async function addProperty(
  store: Store,
  actor: Actor,
  customerId: string,
  input: PropertyInput,
) {
  assertRole(actor, MANAGEMENT);
  await requireEditableCustomer(store, customerId);
  const created = await store.property.create({
    data: { customerId, ...propertyData(input) },
    select: { id: true },
  });
  await logCustomerEvent(store, actor, "customer.property_added", customerId, {
    propertyId: created.id,
  });
  return created;
}

export async function updateProperty(
  store: Store,
  actor: Actor,
  propertyId: string,
  input: PropertyInput,
) {
  assertRole(actor, MANAGEMENT);
  const existing = await store.property.findUnique({ where: { id: propertyId } });
  if (!existing) throw new DomainError("That property could not be found.");
  await findEditableCustomer(store, existing.customerId);
  if (existing.archivedAt) throw new DomainError("This property is archived.");
  const data = propertyData(input);
  const changed = changedFields(existing, data);
  // A save that changes nothing writes nothing: no lock, no update, no audit line.
  if (changed.length === 0) return;
  await lockCustomer(store, existing.customerId);
  await store.property.update({ where: { id: propertyId }, data });
  await logCustomerEvent(store, actor, "customer.property_updated", existing.customerId, {
    propertyId,
    changed,
  });
}

export async function archiveProperty(store: Store, actor: Actor, propertyId: string) {
  assertRole(actor, MANAGEMENT);
  const existing = await store.property.findUnique({ where: { id: propertyId } });
  if (!existing) throw new DomainError("That property could not be found.");
  // Already archived: nothing to do, so write nothing (no lock, no update, no audit line).
  if (existing.archivedAt) return;
  await requireEditableCustomer(store, existing.customerId);
  await store.property.update({ where: { id: propertyId }, data: { archivedAt: new Date() } });
  await logCustomerEvent(store, actor, "customer.property_archived", existing.customerId, {
    propertyId,
  });
}
