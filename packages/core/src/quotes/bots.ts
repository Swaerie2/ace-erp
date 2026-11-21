import { createHash } from "node:crypto";

const PREVIEW_BOTS =
  /whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|slackbot|slack-imgproxy|discordbot|linkedinbot|googlebot|bingbot|applebot|skypeuripreview|pinterestbot|embedly|vkshare|crawler|spider|preview|\bbot\b|bot\//i;

/** Link previews and crawlers get a bare page and never count as a view. A missing user agent counts too. */
export function isPreviewBot(userAgent: string | null | undefined): boolean {
  if (!userAgent || !userAgent.trim()) return true;
  return PREVIEW_BOTS.test(userAgent);
}

/** The visitor's address as a hash, so the rate limiter never stores the address itself. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`ace-link-v1:${ip}`).digest("hex");
}
