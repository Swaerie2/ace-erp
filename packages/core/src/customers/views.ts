import type { Prisma } from "../generated/prisma/client";

/**
 * Everything a CREW member may see. This is the ONLY query shape used for crew, so a new screen
 * cannot leak a field by accident. NO fees, emails, phones, billing details or notes.
 */
export const CREW_CUSTOMER_SELECT = {
  id: true,
  number: true,
  displayName: true,
  status: true,
  properties: {
    where: { archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      label: true,
      addressLine1: true,
      addressLine2: true,
      suburb: true,
      city: true,
      postalCode: true,
      mapUrl: true,
      accessNotes: true,
    },
  },
} as const satisfies Prisma.CustomerSelect;

export type CrewCustomer = Prisma.CustomerGetPayload<{ select: typeof CREW_CUSTOMER_SELECT }>;
