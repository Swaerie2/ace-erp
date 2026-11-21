import { describe, expect, it } from "vitest";
import { hashIp, isPreviewBot } from "./bots";

describe("isPreviewBot", () => {
  it("recognises link previews and crawlers", () => {
    for (const ua of [
      "WhatsApp/2.23.20.0 A",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Twitterbot/1.0",
      "TelegramBot (like TwitterBot)",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      "LinkedInBot/1.0 (compatible; Mozilla/5.0)",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    ]) {
      expect(isPreviewBot(ua), ua).toBe(true);
    }
  });
  it("treats a missing or empty user agent as a bot", () => {
    expect(isPreviewBot(undefined)).toBe(true);
    expect(isPreviewBot(null)).toBe(true);
    expect(isPreviewBot("")).toBe(true);
  });
  it("lets real browsers through", () => {
    for (const ua of [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    ]) {
      expect(isPreviewBot(ua), ua).toBe(false);
    }
  });
});

describe("hashIp", () => {
  it("is a stable 64 character hex string that does not contain the address", () => {
    const h = hashIp("203.0.113.7");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp("203.0.113.7")).toBe(h);
    expect(hashIp("203.0.113.8")).not.toBe(h);
    expect(h).not.toContain("203");
  });
});
