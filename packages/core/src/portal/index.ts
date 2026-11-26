// The client portal's entry point: `@ace/core/portal`. Only the portal app imports from here.
// Functions exported here take a PortalScope (computed from the signed-in session), never a staff Actor,
// so they are deliberately NOT exported from the main `@ace/core` barrel.
export { CODE_TTL_MINUTES, MAX_CODE_ATTEMPTS } from "./codes";
export { getPortalBaseUrl, portalSignInUrl } from "./config";
export {
  PENDING_EMAIL_MAX_AGE_SECONDS,
  portalCookieNames,
  type PortalCookieNames,
} from "./cookies";
export { normaliseEmail } from "./email-address";
export { needsWelcome, type PortalScope, type ScopeContact } from "./scope";
export { sendEmail, type EmailMessage } from "./email/send";
export { signInCodeEmail, welcomeEmail } from "./email/templates";
