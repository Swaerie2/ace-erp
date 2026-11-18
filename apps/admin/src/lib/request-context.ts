import "server-only";
import { headers } from "next/headers";

/** Where a request came from. Recorded in the audit log, never used for access decisions. */
export async function requestContext(): Promise<{ ip?: string; userAgent?: string }> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? undefined;
  const userAgent = h.get("user-agent") ?? undefined;
  return {
    ...(ip ? { ip } : {}),
    ...(userAgent ? { userAgent: userAgent.slice(0, 300) } : {}),
  };
}
