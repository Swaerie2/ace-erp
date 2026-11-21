import "server-only";
import { cleanUserAgent, clientIpFromHeaders, hashIp, isPreviewBot } from "@ace/core";
import { headers } from "next/headers";

export type Visitor = {
  ip: string | null;
  userAgent: string | null;
  /** SHA-256 of the address: the only form in which it is ever kept by the rate limiter. */
  ipHash: string;
  /** Link previews, crawlers, and clients that send no browser string at all. */
  isBot: boolean;
};

export async function getVisitor(): Promise<Visitor> {
  const h = await headers();
  const ip = clientIpFromHeaders((name) => h.get(name));
  const userAgent = cleanUserAgent(h.get("user-agent"));
  return { ip, userAgent, ipHash: hashIp(ip ?? "unknown"), isBot: isPreviewBot(userAgent) };
}
