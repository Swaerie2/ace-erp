// The client portal's entry point: `@ace/core/portal`. Only the portal app imports from here.
// Functions exported here take a PortalScope (computed from the signed-in session), never a staff Actor,
// so they are deliberately NOT exported from the main `@ace/core` barrel.
export { CODE_TTL_MINUTES, MAX_CODE_ATTEMPTS } from "./codes";
export { getPortalBaseUrl, portalSignInUrl } from "./config";
export {
  PENDING_EMAIL_MAX_AGE_SECONDS,
  portalCookieNames,
  portalCookieOptions,
  type PortalCookieNames,
  type PortalCookieOptions,
} from "./cookies";
export { normaliseEmail } from "./email-address";
export { needsWelcome, type PortalScope, type ScopeContact } from "./scope";
export { assertEmailConfigured, sendEmail, type EmailMessage } from "./email/send";
export { signInCodeEmail, welcomeEmail } from "./email/templates";
export type { PortalStore } from "./store";
export {
  getPortalSession,
  requestSignInCode,
  signOut,
  verifySignInCode,
  type PortalSession,
  type RequestCodeOutcome,
  type SignInCodeMessage,
  type VerifyResult,
} from "./signin";
export { welcomeSchema, type WelcomeInput } from "./welcome-schema";
export { WELCOME_GONE, completeWelcome, getWelcomeStep, type WelcomeStep } from "./welcome";
export {
  acceptPortalQuote,
  declinePortalQuote,
  getPortalQuote,
  type PortalAcceptResult,
  type PortalDeclineResult,
  type PortalQuoteView,
} from "./quotes";
export {
  getPortalHome,
  type PortalCustomerGroup,
  type PortalHome,
  type PortalPropertyGroup,
  type PortalQuoteState,
  type PortalQuoteSummary,
} from "./home";
export { grantPortalAccess, type InviteDeps, type TxRunner } from "./access";
