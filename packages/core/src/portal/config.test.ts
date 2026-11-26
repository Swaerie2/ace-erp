import { describe, expect, it } from "vitest";
import { getPortalBaseUrl, portalSignInUrl } from "./config";

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

describe("portal address", () => {
  it("uses PORTAL_URL without a trailing slash", () => {
    expect(
      getPortalBaseUrl(env({ NODE_ENV: "production", PORTAL_URL: "https://portal.example.com/" })),
    ).toBe("https://portal.example.com");
    expect(
      portalSignInUrl(env({ NODE_ENV: "production", PORTAL_URL: "https://portal.example.com" })),
    ).toBe("https://portal.example.com/sign-in");
  });
  it("defaults to the local portal in development", () => {
    expect(getPortalBaseUrl(env({ NODE_ENV: "development" }))).toBe("http://localhost:3200");
  });
  it("refuses to guess in production", () => {
    expect(() => getPortalBaseUrl(env({ NODE_ENV: "production" }))).toThrow(
      "PORTAL_URL is not set.",
    );
  });
});
