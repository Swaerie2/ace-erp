import type { Prisma } from "../generated/prisma/client";
import { assertRole, MANAGEMENT, type Actor } from "./access";
import type { Store } from "./store";

export type DuplicateMatch = {
  customerId: string;
  number: number;
  displayName: string;
  reason: "email" | "phone";
};

/** Warns about other customers sharing an email or phone. A warning only, never a block. */
export async function findDuplicateContacts(
  store: Store,
  actor: Actor,
  input: { emails: string[]; phones: string[]; excludeCustomerId?: string | undefined },
): Promise<DuplicateMatch[]> {
  assertRole(actor, MANAGEMENT);
  const emails = input.emails.filter(Boolean);
  const phones = input.phones.filter(Boolean);
  if (emails.length === 0 && phones.length === 0) return [];

  const or: Prisma.ContactWhereInput[] = [];
  if (emails.length) or.push({ email: { in: emails } });
  if (phones.length) or.push({ phone: { in: phones } });

  const rows = await store.contact.findMany({
    where: {
      OR: or,
      customer: { anonymisedAt: null },
      ...(input.excludeCustomerId ? { customerId: { not: input.excludeCustomerId } } : {}),
    },
    select: {
      email: true,
      customer: { select: { id: true, number: true, displayName: true } },
    },
    take: 20,
  });

  const seen = new Map<string, DuplicateMatch>();
  for (const row of rows) {
    if (seen.has(row.customer.id)) continue;
    seen.set(row.customer.id, {
      customerId: row.customer.id,
      number: row.customer.number,
      displayName: row.customer.displayName,
      reason: row.email && emails.includes(row.email) ? "email" : "phone",
    });
  }
  return [...seen.values()];
}
