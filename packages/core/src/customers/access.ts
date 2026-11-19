import type { StaffRole } from "../generated/prisma/enums";

/** Who is asking. Built by the app from the signed-in staff member. */
export type Actor = { id: string; role: StaffRole; ip?: string; userAgent?: string };

/** The actor's role does not allow this. The app turns it into the /forbidden page. */
export class ForbiddenError extends Error {
  constructor() {
    super("You do not have access to this.");
    this.name = "ForbiddenError";
  }
}

/** A problem the user can fix. The message is safe to show on screen. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export const MANAGEMENT: readonly StaffRole[] = ["OWNER", "MANAGER"];
export const OWNER_ONLY: readonly StaffRole[] = ["OWNER"];

export function assertRole(actor: Actor, allowed: readonly StaffRole[]): void {
  if (!allowed.includes(actor.role)) throw new ForbiddenError();
}
