import type { Db } from "../db";

/**
 * Everything the portal-facing functions may touch. Works with `getPortalDb()` (the `ace_portal` login in
 * production) or a transaction. Every call through it names its columns: the role has column grants only.
 */
export type PortalStore = Pick<
  Db,
  | "contact"
  | "customer"
  | "property"
  | "quote"
  | "quoteLine"
  | "quoteScopeItem"
  | "auditLog"
  | "publicLinkHit"
  | "portalCode"
  | "portalSession"
  | "$queryRaw"
>;
