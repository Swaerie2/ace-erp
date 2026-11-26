import { describe, expect, it } from "vitest";
import {
  SIGN_IN_SUBJECT,
  WELCOME_SUBJECT,
  escapeHtml,
  signInCodeEmail,
  welcomeEmail,
} from "./templates";

const EM_DASH = String.fromCharCode(0x2014);

describe("the sign-in code email", () => {
  const email = signInCodeEmail({ to: "zz.client@example.com", code: "042917" });
  it("has a fixed subject with nothing personal in it", () => {
    expect(email.subject).toBe(SIGN_IN_SUBJECT);
    expect(email.subject).toBe("Your ACE sign-in code");
    expect(email.subject).not.toContain("042917");
  });
  it("carries the code in both parts and says how long it works", () => {
    expect(email.to).toBe("zz.client@example.com");
    expect(email.text).toContain("042917");
    expect(email.html).toContain("042917");
    expect(email.text).toContain("10 minutes");
  });
  it("uses no em dashes", () => {
    expect(email.text + email.html + email.subject).not.toContain(EM_DASH);
  });
});

describe("the welcome email", () => {
  const email = welcomeEmail({
    to: "zz.client@example.com",
    name: "ZZ <b>Client</b>",
    signInUrl: "https://portal.example.com/sign-in",
  });
  it("has a fixed subject with nothing personal in it", () => {
    expect(email.subject).toBe(WELCOME_SUBJECT);
    expect(email.subject).toBe("Welcome to the ACE client portal");
  });
  it("links to the sign-in page with no secret, and escapes the name in the HTML", () => {
    expect(email.text).toContain("https://portal.example.com/sign-in");
    expect(email.html).toContain('href="https://portal.example.com/sign-in"');
    expect(email.html).toContain("ZZ &lt;b&gt;Client&lt;/b&gt;");
    expect(email.html).not.toContain("<b>Client</b>");
    expect(email.text).toContain("ZZ <b>Client</b>");
  });
  it("uses no em dashes", () => {
    expect(email.text + email.html + email.subject).not.toContain(EM_DASH);
  });
});

describe("escapeHtml", () => {
  it("escapes the five special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});
