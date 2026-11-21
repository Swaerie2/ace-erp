import { describe, expect, it } from "vitest";
import { getPortalDatabaseUrl } from "./portal-db";

const dev = { DATABASE_URL: "postgres://dev" } as unknown as NodeJS.ProcessEnv;

describe("getPortalDatabaseUrl", () => {
  it("uses PORTAL_DATABASE_URL when it is set", () => {
    expect(
      getPortalDatabaseUrl({
        ...dev,
        PORTAL_DATABASE_URL: "postgres://portal",
        NODE_ENV: "production",
      } as unknown as NodeJS.ProcessEnv),
    ).toBe("postgres://portal");
  });
  it("falls back to DATABASE_URL outside production", () => {
    expect(
      getPortalDatabaseUrl({ ...dev, NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv),
    ).toBe("postgres://dev");
  });
  it("refuses to start in production without its own login", () => {
    expect(() =>
      getPortalDatabaseUrl({ ...dev, NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv),
    ).toThrow(
      "PORTAL_DATABASE_URL is not set. In production the client portal must use its own low-privilege database login.",
    );
  });
});
