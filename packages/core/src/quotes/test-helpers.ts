import { randomUUID } from "node:crypto";
import type { Actor } from "../customers/access";
import { createCustomer } from "../customers/customers";
import { contactSchema, customerSchema, propertySchema } from "../customers/schemas";
import type { Prisma } from "../generated/prisma/client";

export const owner: Actor = { id: randomUUID(), role: "OWNER" };
export const manager: Actor = { id: randomUUID(), role: "MANAGER" };
export const crew: Actor = { id: randomUUID(), role: "CREW" };

/** A short unique token, so test rows never collide with, or are found among, existing rows. */
export const token = () => randomUUID().replaceAll("-", "").slice(0, 10);
const uniquePhone = () => `082${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

/** A made-up customer with one contact and one property. */
export async function makeCustomer(
  tx: Prisma.TransactionClient,
  status: "LEAD" | "ACTIVE" = "LEAD",
) {
  const { id } = await createCustomer(tx, manager, {
    customer: customerSchema.parse({
      type: "PERSON",
      displayName: `Quote Test ${token()}`,
      status,
    }),
    contact: contactSchema.parse({
      name: `Contact ${token()}`,
      email: `${randomUUID()}@example.com`,
      phone: uniquePhone(),
    }),
    property: propertySchema.parse({
      label: "Main",
      addressLine1: "1 Quote Street",
      suburb: "Testville",
    }),
  });
  const property = await tx.property.findFirstOrThrow({ where: { customerId: id } });
  const contact = await tx.contact.findFirstOrThrow({ where: { customerId: id } });
  return { customerId: id, propertyId: property.id, contactName: contact.name };
}
