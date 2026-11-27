import { CODE_TTL_MINUTES } from "../codes";
import type { EmailMessage } from "./send";

// Subject lines carry nothing personal.
export const SIGN_IN_SUBJECT = "Your ACE sign-in code";
export const WELCOME_SUBJECT = "Welcome to the ACE client portal";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function wrap(inner: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f0e3;font-family:Arial,Helvetica,sans-serif;color:#242018"><div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px"><p style="margin:0 0 16px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#b5651d">ACE Garden Services</p>${inner}</div></body></html>`;
}

export function signInCodeEmail(input: { to: string; code: string }): EmailMessage {
  const text = [
    "Your ACE client portal sign-in code is:",
    "",
    input.code,
    "",
    `It works once, for ${CODE_TTL_MINUTES} minutes.`,
    "If you did not ask for this code, you can ignore this email.",
    "",
    "ACE Garden Services",
  ].join("\n");
  const html = wrap(
    `<p style="margin:0 0 12px">Your ACE client portal sign-in code is:</p>` +
      `<p style="margin:0 0 16px;font-size:32px;font-weight:bold;letter-spacing:6px;color:#22422e">${escapeHtml(input.code)}</p>` +
      `<p style="margin:0 0 8px">It works once, for ${CODE_TTL_MINUTES} minutes.</p>` +
      `<p style="margin:0;color:#6b6457">If you did not ask for this code, you can ignore this email.</p>`,
  );
  return { to: input.to, subject: SIGN_IN_SUBJECT, text, html };
}

export function welcomeEmail(input: { to: string; name: string; signInUrl: string }): EmailMessage {
  const text = [
    `Hello ${input.name},`,
    "",
    "You can now see your quotes from ACE Garden Services in our client portal, and accept or decline them there.",
    "",
    `Sign in here: ${input.signInUrl}`,
    "",
    "Enter this email address and we will email you a short code. There is no password.",
    "",
    "ACE Garden Services",
  ].join("\n");
  const html = wrap(
    `<p style="margin:0 0 12px">Hello ${escapeHtml(input.name)},</p>` +
      `<p style="margin:0 0 16px">You can now see your quotes from ACE Garden Services in our client portal, and accept or decline them there.</p>` +
      `<p style="margin:0 0 16px"><a href="${escapeHtml(input.signInUrl)}" style="display:inline-block;background:#22422e;color:#f6f0e3;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Sign in to the portal</a></p>` +
      `<p style="margin:0;color:#6b6457">Enter this email address and we will email you a short code. There is no password.</p>`,
  );
  return { to: input.to, subject: WELCOME_SUBJECT, text, html };
}
