import { describe, expect, it } from "vitest";
import { PENDING_EMAIL_MAX_AGE_SECONDS, portalCookieNames } from "./cookies";

describe("portal cookie names", () => {
  it("use the __Host- prefix in production only", () => {
    expect(portalCookieNames("production")).toEqual({
      session: "__Host-ace-portal",
      pendingEmail: "__Host-ace-portal-email",
    });
    expect(portalCookieNames("development")).toEqual({
      session: "ace-portal",
      pendingEmail: "ace-portal-email",
    });
    expect(portalCookieNames(undefined)).toEqual(portalCookieNames("development"));
  });
  it("keep the typed email for fifteen minutes", () => {
    expect(PENDING_EMAIL_MAX_AGE_SECONDS).toBe(900);
  });
});
