import "server-only";
import type { Actor } from "@ace/core";
import type { StaffSession } from "@/lib/auth";
import { requestContext } from "@/lib/request-context";

/** The signed-in staff member plus where the request came from, as the core functions expect. */
export async function toActor(staff: StaffSession): Promise<Actor> {
  return { id: staff.id, role: staff.role, ...(await requestContext()) };
}
