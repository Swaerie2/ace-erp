export { getDb } from "./db";
export * from "./portal-db";
export type { Db } from "./db";
export { getDatabaseUrl, requireEnv } from "./env";
export { getPortalBaseUrl, portalSignInUrl } from "./portal/config";
export { sendEmail, type EmailMessage } from "./portal/email/send";
export { signInCodeEmail, welcomeEmail } from "./portal/email/templates";
export {
  HIERARCHY_MESSAGES,
  clearManagedBy,
  getCustomerHierarchy,
  searchAgencies,
  setBillsToManager,
  setManagedBy,
  type AgencyOption,
  type CustomerHierarchy,
  type HierarchyMessageKey,
} from "./portal/hierarchy";
export {
  PORTAL_ACCESS_MESSAGES,
  grantPortalAccess,
  inviteContact,
  removeContactAccess,
  sendWelcomeEmails,
  type InviteDeps,
  type PortalInvite,
  type TxRunner,
} from "./portal/access";
export { recordAudit } from "./audit";
export type { AuditEntry } from "./audit";
export { computeTotals, formatZAR, randToCents, sumCents } from "./money";
export type { Cents, Totals, VatSettings } from "./money";
export { getSupabaseAdmin } from "./supabase-admin";
export { createStaffUser, createStaffInput, MIN_PASSWORD_LENGTH } from "./staff";
export type { CreateStaffInput } from "./staff";
export { AuditActorType, StaffRole } from "./generated/prisma/enums";
export * from "./customers";
export * from "./services";
export * from "./quotes";
