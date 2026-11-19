import { randomUUID } from "node:crypto";
import type { Actor } from "../customers/access";
import { createCustomer } from "../customers/customers";
import { contactSchema, customerSchema, propertySchema } from "../customers/schemas";
import type { Prisma } from "../generated/prisma/client";
import { saveDraft } from "./drafts";
import { toDateString } from "./reference";
import type { DraftInput, DraftLineInput } from "./schemas";
import { findQuote } from "./store";

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

export const monthlyLine = (over: Partial<DraftLineInput> = {}): DraftLineInput => ({
  lineKind: "PRICED",
  billing: "MONTHLY",
  frequency: "WEEKLY",
  description: "Weekly garden maintenance, as per scope",
  amountCents: 115000,
  ...over,
});

export const onceOffLine = (over: Partial<DraftLineInput> = {}): DraftLineInput => ({
  lineKind: "PRICED",
  billing: "ONCE_OFF",
  frequency: null,
  description: "Once-off clean-up",
  amountCents: 240000,
  ...over,
});

export const optionalLine = (over: Partial<DraftLineInput> = {}): DraftLineInput => ({
  lineKind: "OPTIONAL",
  billing: "MONTHLY",
  frequency: "AS_REQUIRED",
  description: "Weed treatment",
  amountCents: 10000,
  ...over,
});

/** Saves a complete draft: the first service included and one monthly line (override as needed). */
export async function fillDraft(
  tx: Prisma.TransactionClient,
  quoteId: string,
  over: Partial<DraftInput> = {},
) {
  const quote = await findQuote(tx, quoteId);
  return saveDraft(tx, manager, quoteId, {
    version: quote.draftVersion,
    validUntil: toDateString(quote.validUntil),
    internalNote: "",
    scope: quote.scopeItems.map((s, index) => ({ serviceId: s.serviceId, included: index === 0 })),
    lines: [monthlyLine()],
    ...over,
  });
}
