# Module 4: Client Portal, Sign-in and Managing Agencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client signs in to the portal with their email and an emailed 6-digit code (no password), completes a short welcome page once, and sees their quotes (open, expired, accepted, declined) with the same accept and decline as the private link. Managing agencies see every complex they manage on a "My complexes" home page. Staff link a complex to its managing agency, choose who the bills go to, and give, re-send and remove portal access.

**Architecture:** A new core folder `packages/core/src/portal/` holds pure helpers (codes, session tokens, cookie names, the visible set), the email module (Resend over `fetch`), the portal-facing functions (sign-in, session, welcome, quotes, home), the access functions (grant after acceptance, staff invite and remove) and the staff hierarchy rules. Portal-facing functions take no staff `Actor`: their authority is a `PortalScope` computed from live data on every request and enforced inside every query. They are exported from a separate entry point `@ace/core/portal`, never from the main `@ace/core` barrel. One hand-written migration adds the columns, two tables (`portal_codes`, `portal_sessions`), and widens the `ace_portal` role by exactly the columns listed in the spec. The portal app gets `/sign-in`, `/sign-in/code`, `/welcome`, `/`, `/quotes/[id]`, `/quotes/[id]/pdf` and sign out; the accept and decline forms become shared components used by the link page and the portal quote page. The staff app gets the Managed by / Bills go to / Complexes managed panel, a Portal panel per contact, and the new quote facts and history labels.

**Tech Stack:** Next.js 16.4 (App Router, server actions, `after`), React 19, TypeScript strict (`noUncheckedIndexedAccess`), Prisma 7 with `@prisma/adapter-pg`, Supabase Postgres, zod 4, vitest 5, Tailwind 4, `@react-pdf/renderer`, Resend HTTP API (plain `fetch`, no new dependency).

**Spec:** `docs/superpowers/specs/2026-11-23-client-portal-design.md` (read all of it; it is short and binding). Module 3b (`docs/superpowers/specs/2026-11-21-quotes-3b-design.md`) is merged and is the base.

## Global Constraints

- Not VAT registered; money whole cents. No em dashes in any text shown on screen or printed (use commas, colons or hyphens).
- Every database call reachable by the portal names its columns with `select` (findUnique/findFirst/findMany/update/create), because the `ace_portal` role has COLUMN-level grants only (updateMany/deleteMany/count are fine). `recordAudit` selects only id. Prisma update/create return full rows unless `select` is given. Where clauses need SELECT on the filtered columns; updates need UPDATE per written column.
- Lock order: customer (when two customers are involved, smaller id first), then property, then quote. Unlocked read first, then lock, then re-read and re-check; status-dependent writes conditional or re-checked.
- Audit lines hold field names, ids and fixed words only: never emails, codes, names, addresses, notes, IPs, browser strings. Portal acts use actor type CUSTOMER (see clientParty in audit.ts).
- Portal-facing core functions take NO staff Actor; their authority is the session scope computed from live data and enforced inside each query. Staff-facing core functions take (store, actor, ...) with assertRole(owner/manager) first. Crew never.
- Sign-in codes: 6 digits, 10 minutes, salted hash, constant-time compare, 5 wrong tries kills a code, single use; sessions: random 32-byte token, only its SHA-256 stored, sliding 30 days, absolute 90 days, deleted on sign-out/removal/anonymise. Never reveal whether an email is on file. Rate limits use the existing rate-limit table with hashed values only.
- Client components never import values from @ace/core (types are fine); the staff app uses @ace/core/client in client components.
- Pages work at 375px with no sideways scroll; interactive controls at least 40px high.
- Database tests run only against the DEV database in always-rolled-back transactions (`npm run test:db`, about 10 minutes; testTimeout 180s, rollback transaction timeout 150s). Each issued quote (makeIssued in quotes/test-helpers.ts) costs about 10 seconds, so keep every test to at most 3 issued quotes and prefer creating contacts/customers directly. Negative tests that make Postgres refuse a statement each run in their own withRollback. The frozen EXPECTED_PORTAL_GRANTS catalogue test must be updated in the same task that changes grants.
- Formatting: never run the root `npm run format` (Windows line-ending noise). Format only touched files with `npx prettier --write <paths>`. Stage by explicit path only (unrelated modified files exist in the working tree). Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Commit locally, never push. Implementers NEVER apply migrations (controller task with the owner's approval).
- Windows: PowerShell needs npm.cmd, Git Bash fine; do not run `npm run build` while a dev server is running. noUncheckedIndexedAccess is on; React hooks lint rules apply (no ref writes during render, no synchronous setState in an effect body). Next.js 16.4 has breaking changes: read node_modules/next/dist/docs before writing Next code (server actions, cookies(), headers(), proxy/middleware conventions, redirect). Server components must never receive event handlers.
- Test data is made up only (names like "ZZ E2E ...", emails @example.com); no real client data.
- Lessons from 3b reviews to apply: re-check status after locks; check tokens/ids again at the locks; PDF/pages must refuse link previews and bots; the portal page can not return HTTP 429 (show a notice), a route can; tests must assert real behaviour (no vacuous assertions) and audit rows must be asserted to contain no typed text; keep exports of functions that have no role check OUT of the package barrels (import them directly); use `omit`/`select` so secrets (codes, hashes) never reach pages or exports.

Notes that apply to every task:

- Several files in the working tree show as modified only because of Windows line endings (for example `packages/core/package.json`, `apps/admin/src/app/(staff)/customers/actions.ts`, `apps/admin/src/components/form.tsx`). When a task edits one of them, staging it by its explicit path is fine. Never stage a file the task does not list.
- `npm run check` may end red on line-ending noise in an untouched file; that one is known. Run the individual commands each task lists.
- Under the `ace_portal` role, `orderBy` and `where` may only use granted columns. Contacts and properties have no `createdAt` grant: order them by `id` or `label`, never `createdAt`.

## Decisions taken in this plan (where the spec left room)

1. The enum value `CLIENT_PORTAL` is added in the same migration file with `ALTER TYPE ... ADD VALUE`. Postgres 12 and later allow this inside a transaction as long as the new value is not used in the same transaction; nothing else in the migration uses it.
2. `quotes.acceptedByContactId` is a foreign key to `contacts` with `ON DELETE SET NULL`, so removing a contact never fails because of an old acceptance (the typed name stays on the quote as proof).
3. The session cookie lasts until the absolute end (90 days); the 30-day sliding end is enforced in the database, so the cookie never needs refreshing from a page. The cookie is `secure` in production; in development it is named `ace-portal` and is not `secure`, so the portal also works over plain `http` on a phone on the local network.
4. Between `/sign-in` and `/sign-in/code` the typed email is kept in a short-lived (15 minutes) HTTP-only cookie (`__Host-ace-portal-email` in production, `ace-portal-email` in development), never in the address bar. It is set the same way whether or not the email is on file.
5. The sign-in email is sent with Next.js `after()` so the reply takes the same time whether or not a code was made.
6. Archived or anonymised complexes are left out of an agency's visible set, the same as archived or anonymised own customers.
7. Phone on the welcome page is optional (some contacts only have an email); when given it is validated and normalised with `normalisePhone`.
8. The staff contact form no longer has a "Can use the client portal" tick box: portal access is changed only by Invite to portal, Remove access and the automatic grant, so ending sign-ins and the "never re-grant after removal" rule cannot be bypassed. `contactSchema` loses `portalAccess`.
9. Removing a contact, or changing a contact's email, ends the sign-ins of the old email when no other contact with that email still has access (same rule as Remove access).
10. Portal sign-ins themselves are not written to the audit log (`lastSignedInAt` records them); welcome, invites, grants, removals and hierarchy changes are.
11. Anonymising a complex clears its Managed by link but writes no extra audit line on the agency (the anonymise order test allows only the one audit line after the scrub).
12. The "My complexes" query lives in `portal/home.ts`; `portal/hierarchy.ts` holds the staff link rules.

## File Structure

```
packages/core/
  package.json                                        MODIFY  export "./portal" (Task 3)
  prisma/schema.prisma                                MODIFY  new columns, relations, two models (Task 1)
  prisma/migrations/20261123120000_client_portal/     CREATE  migration.sql (Task 1)
  src/index.ts                                        MODIFY  staff-facing portal exports (Tasks 3, 4, 5, 9)
  src/quotes/schemas.ts                               MODIFY  CLIENT_PORTAL label (Task 1)
  src/quotes/portal-role.db.test.ts                   MODIFY  new frozen grants, new role checks (Task 1)
  src/quotes/rate-limit-window.ts (+test)             MODIFY  per-kind limits and windows (Task 3)
  src/quotes/public.ts                                MODIFY  checkRateLimit per kind (Task 3); buildPublicView (Task 8); quoteId in result (Task 9)
  src/quotes/acceptance.ts                            MODIFY  CLIENT_PORTAL, acceptedByContactId, decline via (Task 8)
  src/quotes/outcomes.ts                              MODIFY  reverse clears acceptedByContactId (Task 8)
  src/quotes/drafts.ts                                MODIFY  getQuote includes the accepting contact (Task 13)
  src/quotes/activity.ts                              MODIFY  "Client (portal)" name (Task 13)
  src/customers/store.ts                              MODIFY  Store gains portal tables (Task 5)
  src/customers/privacy.ts                            MODIFY  agency refusal, link cleared, sign-ins ended (Task 5)
  src/customers/privacy-coverage.test.ts              MODIFY  classify new columns and tables (Task 1)
  src/customers/privacy-order.test.ts                 MODIFY  fake store knows the new calls (Task 5)
  src/customers/contacts.ts                           MODIFY  end sign-ins on remove / email change (Task 9)
  src/customers/schemas.ts, mappers.ts, schemas.test  MODIFY  portalAccess leaves the contact form (Task 9)
  src/customers/customers.ts                          MODIFY  activity names by actor type (Task 13)
  src/portal/
    index.ts                                          CREATE  the @ace/core/portal entry point (Task 3, grows)
    email-address.ts, codes.ts, session-token.ts,
    cookies.ts, config.ts (+ tests)                   CREATE  pure helpers (Task 3)
    scope.ts (+ scope.test.ts)                        CREATE  pure scope rules (Task 3); loadPortalScope (Task 6)
    email/send.ts, email/templates.ts (+ tests)       CREATE  sendEmail and the two emails (Task 4)
    end-sign-ins.ts                                   CREATE  delete sessions and codes for emails (Task 5)
    hierarchy.ts (+ db test)                          CREATE  staff link rules (Task 5)
    anonymise.db.test.ts                              CREATE  anonymise and the portal (Task 5)
    store.ts                                          CREATE  PortalStore type (Task 6)
    test-helpers.ts                                   CREATE  made-up clients, sessions, role switch (Task 6)
    signin.ts (+ db test)                             CREATE  codes, sessions, sign out, cleanup (Task 6)
    db-protection.db.test.ts                          CREATE  RLS and constraints of the new tables (Task 1)
    welcome-schema.ts (+test), welcome.ts (+db test)  CREATE  the welcome page (Task 7)
    quotes.ts, home.ts (+ tests)                      CREATE  quotes and My complexes for a scope (Task 8)
    access.ts (+ db test)                             CREATE  grant, invite, remove (Task 9)
    staff-views.db.test.ts                            CREATE  staff facts and history names (Task 13)
apps/portal/
  next.config.ts                                      MODIFY  signed-in page headers (Task 10)
  src/lib/session.ts, form.ts, portal-access.ts       CREATE  session, form helpers, grant after accept (Tasks 9, 10)
  src/components/                                     CREATE  notices, shared quote forms, header (Task 10)
  src/app/q/[token]/                                  MODIFY  use shared forms; grant after accept (Tasks 9, 10)
  src/app/actions.ts                                  CREATE  sign out (Task 10)
  src/app/sign-in/**, src/app/welcome/**              CREATE  (Task 11)
  src/app/page.tsx, src/app/quotes/[id]/**            CREATE/MODIFY  home, quote page, actions, PDF (Task 12)
apps/admin/
  src/lib/portal-url.ts                               MODIFY  delegates to core (Task 3)
  src/lib/portal-access.ts                            CREATE  grant after staff accept (Task 9)
  src/app/(staff)/quotes/actions.ts                   MODIFY  grant after accept (Task 9)
  src/app/(staff)/customers/**                        MODIFY  hierarchy panel, portal panel (Tasks 9, 13)
  src/app/(staff)/quotes/[id]/quote-facts.tsx         MODIFY  portal acceptance facts (Task 13)
docs/, .env.example                                   MODIFY  (Task 14)
```

---

### Task 1: Database change: portal columns, sign-in tables and wider `ace_portal` grants (not applied)

**Files:**
- Modify: `packages/core/prisma/schema.prisma`
- Create: `packages/core/prisma/migrations/20261123120000_client_portal/migration.sql`
- Modify: `packages/core/src/quotes/schemas.ts` (label for the new accept method, so the staff app keeps type-checking)
- Modify: `packages/core/src/customers/privacy-coverage.test.ts` (classify every new column and the two new tables)
- Modify: `packages/core/src/quotes/portal-role.db.test.ts` (the frozen grant list and the role checks)
- Create: `packages/core/src/portal/db-protection.db.test.ts`

**Interfaces:**
- Produces (Prisma, after `db:generate`): `Customer.managedById String?`, `Customer.billsToManager Boolean` (default true), relations `Customer.managedBy` / `Customer.managedCustomers` (relation name `"CustomerManagement"`); `Contact.portalInvitedAt`, `Contact.portalWelcomedAt`, `Contact.lastSignedInAt` (`DateTime?`), relation `Contact.acceptedQuotes`; `Quote.acceptedByContactId String?` with relation `Quote.acceptedByContact` (relation name `"QuoteAcceptedByContact"`); enum value `QuoteAcceptMethod.CLIENT_PORTAL`; models `PortalCode` (delegate `portalCode`) and `PortalSession` (delegate `portalSession`).
- Produces: `ACCEPT_METHOD_LABELS` gains `CLIENT_PORTAL: "Client portal"`.

The database tests written in this task cannot pass until the controller applies the migration (Task 2). Do NOT run `npm run test:db`, `db:deploy` or `db:migrate`.

- [ ] **Step 1: Edit `schema.prisma`**

Header comment: change the line `// services, quotes, client link. Invoices arrive in Module 5, and so on.` to `// services, quotes, client link, client portal. Invoices arrive in Module 5, and so on.` (and `Modules 0 to 3` to `Modules 0 to 4`).

In `model Customer`, after `consentNote`, add:

```prisma
  /// Module 4: the managing agency of this complex (an ordinary customer). One level only. Cleared on anonymise.
  managedById         String?         @db.Uuid
  /// Module 4: while managed, true = bills go to the agency, false = to the complex itself.
  billsToManager      Boolean         @default(true)
```

and in its relation block (after `quotes Quote[]`):

```prisma
  managedBy        Customer?  @relation("CustomerManagement", fields: [managedById], references: [id], onDelete: Restrict)
  managedCustomers Customer[] @relation("CustomerManagement")
```

and next to the other indexes: `@@index([managedById])`.

In `model Contact`, after `portalAccess`, add:

```prisma
  /// Module 4: when portal access was first given (kept after removal, so access is never silently re-granted).
  portalInvitedAt  DateTime?
  /// Module 4: when this person completed the portal welcome page.
  portalWelcomedAt DateTime?
  /// Module 4: last successful portal sign-in.
  lastSignedInAt   DateTime?
```

and after `customer Customer @relation(...)`:

```prisma
  acceptedQuotes Quote[] @relation("QuoteAcceptedByContact")
```

In `enum QuoteAcceptMethod`, add `CLIENT_PORTAL` as the last value (after `CLIENT_LINK`).

In `model Quote`, after `declinedByClient`, add:

```prisma
  /// Module 4: the signed-in contact who accepted in the portal. The agency is implied when that contact's
  /// customer is not the quote's customer.
  acceptedByContactId   String?            @db.Uuid
```

and in its relation block (after `lines QuoteLine[]`):

```prisma
  acceptedByContact Contact? @relation("QuoteAcceptedByContact", fields: [acceptedByContactId], references: [id], onDelete: SetNull)
```

Append at the end of the file:

```prisma
/// Module 4: one-time sign-in codes for the client portal. Only a salted hash of the code is stored.
/// `email` is personal data: rows are deleted when access is removed or the customer is anonymised.
model PortalCode {
  id        String    @id @default(uuid()) @db.Uuid
  /// Lowercase (database constraint).
  email     String
  codeHash  String
  salt      String
  expiresAt DateTime
  attempts  Int       @default(0)
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([email])
  @@map("portal_codes")
}

/// Module 4: signed-in portal sessions. Only the SHA-256 of the random cookie value is stored.
/// `email` is personal data: rows are deleted on sign out, access removal and anonymise.
model PortalSession {
  id                String   @id @default(uuid()) @db.Uuid
  tokenHash         String   @unique
  /// Lowercase (database constraint).
  email             String
  createdAt         DateTime @default(now())
  lastSeenAt        DateTime
  /// Sliding: 30 days after the last use, never past absoluteExpiresAt.
  expiresAt         DateTime
  /// 90 days after sign-in.
  absoluteExpiresAt DateTime

  @@index([email])
  @@map("portal_sessions")
}
```

Run in `packages/core`: `npm run db:validate` then `npm run db:generate`. Expected: both succeed. (Use `npx prisma format` only if the file is misaligned; it only re-spaces.)

- [ ] **Step 2: Write the migration by hand** `packages/core/prisma/migrations/20261123120000_client_portal/migration.sql` (do not use `migrate diff`; it prints an environment banner into stdout):

```sql
-- AlterEnum
-- Postgres 12+ allows ADD VALUE inside the migration transaction because nothing below uses the new value.
ALTER TYPE "QuoteAcceptMethod" ADD VALUE 'CLIENT_PORTAL';

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "lastSignedInAt" TIMESTAMP(3),
ADD COLUMN "portalInvitedAt" TIMESTAMP(3),
ADD COLUMN "portalWelcomedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "billsToManager" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "managedById" UUID;

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN "acceptedByContactId" UUID;

-- CreateTable
CREATE TABLE "portal_codes" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_sessions" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_managedById_idx" ON "customers"("managedById");

-- CreateIndex
CREATE INDEX "portal_codes_email_idx" ON "portal_codes"("email");

-- CreateIndex
CREATE UNIQUE INDEX "portal_sessions_tokenHash_key" ON "portal_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "portal_sessions_email_idx" ON "portal_sessions"("email");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_managedById_fkey" FOREIGN KEY ("managedById") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_acceptedByContactId_fkey" FOREIGN KEY ("acceptedByContactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Protections (same rules as the earlier migrations)
-- ---------------------------------------------------------------------------
ALTER TABLE "portal_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_sessions" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "portal_codes", "portal_sessions" FROM %I', r);
    END IF;
  END LOOP;
END $$;

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_not_managed_by_itself" CHECK ("managedById" IS NULL OR "managedById" <> "id");
ALTER TABLE "portal_codes"
  ADD CONSTRAINT "portal_codes_email_lowercase" CHECK ("email" = lower("email"));
ALTER TABLE "portal_codes"
  ADD CONSTRAINT "portal_codes_attempts_not_negative" CHECK ("attempts" >= 0);
ALTER TABLE "portal_sessions"
  ADD CONSTRAINT "portal_sessions_email_lowercase" CHECK ("email" = lower("email"));

-- ---------------------------------------------------------------------------
-- The ace_portal role gains exactly what the Module 4 portal functions need (spec, "Technical design").
-- It still cannot touch staff users, services, wording, settings or the audit history, and it can neither
-- read nor write properties.accessNotes.
-- ---------------------------------------------------------------------------
GRANT SELECT (
  "id", "customerId", "name", "role", "email", "phone", "receivesQuotes", "portalAccess",
  "portalInvitedAt", "portalWelcomedAt", "lastSignedInAt"
) ON "contacts" TO "ace_portal";
GRANT UPDATE (
  "name", "phone", "portalAccess", "portalInvitedAt", "portalWelcomedAt", "lastSignedInAt", "updatedAt"
) ON "contacts" TO "ace_portal";

GRANT SELECT (
  "displayName", "type", "companyName", "archivedAt", "billingLine1", "billingLine2", "billingSuburb",
  "billingCity", "billingPostalCode", "consentAt", "consentSource", "managedById", "billsToManager"
) ON "customers" TO "ace_portal";
GRANT UPDATE (
  "billingLine1", "billingLine2", "billingSuburb", "billingCity", "billingPostalCode", "consentAt",
  "consentSource", "consentNote"
) ON "customers" TO "ace_portal";

GRANT SELECT ("label", "addressLine1", "addressLine2", "suburb", "city", "postalCode") ON "properties" TO "ace_portal";

GRANT UPDATE ("acceptedByContactId") ON "quotes" TO "ace_portal";

GRANT SELECT, INSERT, UPDATE, DELETE ON "portal_codes" TO "ace_portal";
GRANT SELECT, INSERT, UPDATE, DELETE ON "portal_sessions" TO "ace_portal";

CREATE POLICY "ace_portal_access" ON "contacts" AS PERMISSIVE FOR ALL TO "ace_portal" USING (true) WITH CHECK (true);
CREATE POLICY "ace_portal_access" ON "portal_codes" AS PERMISSIVE FOR ALL TO "ace_portal" USING (true) WITH CHECK (true);
CREATE POLICY "ace_portal_access" ON "portal_sessions" AS PERMISSIVE FOR ALL TO "ace_portal" USING (true) WITH CHECK (true);
```

Before committing, cross-check every column name in the GRANT lines against `schema.prisma` (`Contact`, `Customer`, `Property`, `Quote`). If one is wrong, fix the SQL, not the schema. Do not mention `CLIENT_PORTAL` anywhere else in this file.

- [ ] **Step 3: Accept method label** in `packages/core/src/quotes/schemas.ts`, change the `ACCEPT_METHOD_LABELS` declaration to:

```ts
export const ACCEPT_METHOD_LABELS: Record<
  (typeof STAFF_ACCEPT_METHODS)[number] | "CLIENT_LINK" | "CLIENT_PORTAL",
  string
> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  PHONE: "Phone",
  IN_PERSON: "In person",
  SIGNED_COPY: "Signed copy",
  CLIENT_LINK: "Client link",
  CLIENT_PORTAL: "Client portal",
};
```

- [ ] **Step 4: Classify the new columns** in `packages/core/src/customers/privacy-coverage.test.ts`.

In `CUSTOMER` add:

```ts
  managedById: "scrubbed",
  billsToManager: "kept: yes/no setting, who bills go to",
```

In `CONTACT` add:

```ts
  portalInvitedAt: "scrubbed",
  portalWelcomedAt: "scrubbed",
  lastSignedInAt: "scrubbed",
```

In `QUOTE` add:

```ts
  acceptedByContactId: "kept: identifier (the contact row itself is scrubbed)",
```

Add two tables above `function check`:

```ts
// Sign-in rows are deleted outright (not scrubbed in place) when access is removed or the customer is
// anonymised; "scrubbed" here means the email goes with the row.
const PORTAL_CODE: Record<string, Rule> = {
  id: "kept: identifier",
  email: "scrubbed",
  codeHash: "kept: one-way hash of a short-lived code, deleted with the row",
  salt: "kept: random salt, not personal",
  expiresAt: "kept: timestamp",
  attempts: "kept: whole number",
  usedAt: "kept: timestamp",
  createdAt: "kept: timestamp",
};

const PORTAL_SESSION: Record<string, Rule> = {
  id: "kept: identifier",
  tokenHash: "kept: one-way hash of a random value, deleted with the row",
  email: "scrubbed",
  createdAt: "kept: timestamp",
  lastSeenAt: "kept: timestamp",
  expiresAt: "kept: timestamp",
  absoluteExpiresAt: "kept: timestamp",
};
```

and in the final `describe`:

```ts
  check("portal codes", Prisma.PortalCodeScalarFieldEnum, PORTAL_CODE);
  check("portal sessions", Prisma.PortalSessionScalarFieldEnum, PORTAL_SESSION);
```

(The scrubbing itself is implemented and proved in Task 5.)

- [ ] **Step 5: Update the frozen role catalogue and role checks** in `packages/core/src/quotes/portal-role.db.test.ts`.

5a. Replace the comment and the whole `EXPECTED_PORTAL_GRANTS` array with:

```ts
// Checked by eye against migrations/20261121120000_client_link and 20261123120000_client_portal: exactly
// what they grant, no more. Sorted with the default JavaScript sort.
const EXPECTED_PORTAL_GRANTS: string[] = [
  "public.audit_log.id:SELECT",
  "public.audit_log:INSERT",
  "public.contacts.customerId:SELECT",
  "public.contacts.email:SELECT",
  "public.contacts.id:SELECT",
  "public.contacts.lastSignedInAt:SELECT",
  "public.contacts.lastSignedInAt:UPDATE",
  "public.contacts.name:SELECT",
  "public.contacts.name:UPDATE",
  "public.contacts.phone:SELECT",
  "public.contacts.phone:UPDATE",
  "public.contacts.portalAccess:SELECT",
  "public.contacts.portalAccess:UPDATE",
  "public.contacts.portalInvitedAt:SELECT",
  "public.contacts.portalInvitedAt:UPDATE",
  "public.contacts.portalWelcomedAt:SELECT",
  "public.contacts.portalWelcomedAt:UPDATE",
  "public.contacts.receivesQuotes:SELECT",
  "public.contacts.role:SELECT",
  "public.contacts.updatedAt:UPDATE",
  "public.customers.anonymisedAt:SELECT",
  "public.customers.archivedAt:SELECT",
  "public.customers.billingCity:SELECT",
  "public.customers.billingCity:UPDATE",
  "public.customers.billingLine1:SELECT",
  "public.customers.billingLine1:UPDATE",
  "public.customers.billingLine2:SELECT",
  "public.customers.billingLine2:UPDATE",
  "public.customers.billingPostalCode:SELECT",
  "public.customers.billingPostalCode:UPDATE",
  "public.customers.billingSuburb:SELECT",
  "public.customers.billingSuburb:UPDATE",
  "public.customers.billsToManager:SELECT",
  "public.customers.companyName:SELECT",
  "public.customers.consentAt:SELECT",
  "public.customers.consentAt:UPDATE",
  "public.customers.consentNote:UPDATE",
  "public.customers.consentSource:SELECT",
  "public.customers.consentSource:UPDATE",
  "public.customers.displayName:SELECT",
  "public.customers.id:SELECT",
  "public.customers.managedById:SELECT",
  "public.customers.status:SELECT",
  "public.customers.status:UPDATE",
  "public.customers.type:SELECT",
  "public.customers.updatedAt:UPDATE",
  "public.portal_codes:DELETE",
  "public.portal_codes:INSERT",
  "public.portal_codes:SELECT",
  "public.portal_codes:UPDATE",
  "public.portal_sessions:DELETE",
  "public.portal_sessions:INSERT",
  "public.portal_sessions:SELECT",
  "public.portal_sessions:UPDATE",
  "public.properties.addressLine1:SELECT",
  "public.properties.addressLine2:SELECT",
  "public.properties.archivedAt:SELECT",
  "public.properties.city:SELECT",
  "public.properties.customerId:SELECT",
  "public.properties.id:SELECT",
  "public.properties.label:SELECT",
  "public.properties.postalCode:SELECT",
  "public.properties.suburb:SELECT",
  "public.properties.updatedAt:UPDATE",
  "public.public_link_hits:DELETE",
  "public.public_link_hits:INSERT",
  "public.public_link_hits:SELECT",
  "public.public_link_hits:UPDATE",
  "public.quote_lines.chosen:UPDATE",
  "public.quote_lines:SELECT",
  "public.quote_scope_items:SELECT",
  "public.quotes.acceptanceNote:UPDATE",
  "public.quotes.acceptedAt:SELECT",
  "public.quotes.acceptedAt:UPDATE",
  "public.quotes.acceptedByContactId:UPDATE",
  "public.quotes.acceptedByName:SELECT",
  "public.quotes.acceptedByName:UPDATE",
  "public.quotes.acceptedByStaffId:UPDATE",
  "public.quotes.acceptedIp:UPDATE",
  "public.quotes.acceptedMethod:SELECT",
  "public.quotes.acceptedMethod:UPDATE",
  "public.quotes.acceptedStartDate:SELECT",
  "public.quotes.acceptedStartDate:UPDATE",
  "public.quotes.acceptedUserAgent:UPDATE",
  "public.quotes.agreementEndedAt:SELECT",
  "public.quotes.agreementEndedAt:UPDATE",
  "public.quotes.agreementReplacedById:SELECT",
  "public.quotes.agreementReplacedById:UPDATE",
  "public.quotes.contentHash:SELECT",
  "public.quotes.customerId:SELECT",
  "public.quotes.declineReason:SELECT",
  "public.quotes.declineReason:UPDATE",
  "public.quotes.declinedAt:SELECT",
  "public.quotes.declinedAt:UPDATE",
  "public.quotes.declinedByClient:SELECT",
  "public.quotes.declinedByClient:UPDATE",
  "public.quotes.firstViewedAt:SELECT",
  "public.quotes.firstViewedAt:UPDATE",
  "public.quotes.id:SELECT",
  "public.quotes.issuedAt:SELECT",
  "public.quotes.lastViewedAt:SELECT",
  "public.quotes.lastViewedAt:UPDATE",
  "public.quotes.linkToken:SELECT",
  "public.quotes.numberSeq:SELECT",
  "public.quotes.numberYear:SELECT",
  "public.quotes.propertyId:SELECT",
  "public.quotes.recipientName:SELECT",
  "public.quotes.revision:SELECT",
  "public.quotes.revisionOfId:SELECT",
  "public.quotes.siteAddress:SELECT",
  "public.quotes.siteLabel:SELECT",
  "public.quotes.status:SELECT",
  "public.quotes.status:UPDATE",
  "public.quotes.updatedAt:UPDATE",
  "public.quotes.validUntil:SELECT",
  "public.quotes.withdrawnAt:SELECT",
  "public.quotes.wordingSnapshot:SELECT",
  "schema public:USAGE",
];
```

5b. Rename the first test to `"holds exactly the privileges the two portal migrations grant, and nothing else"` (body unchanged).

5c. In the quote-columns test, add `"acceptedByContactId"` to the `writable` array (it stays out of `readable`; add it to `hidden`, because the portal never reads it).

5d. Replace the whole body of the test `"has no access to anything else it does not need"` with:

```ts
    await withRollback(async (tx) => {
      for (const table of [
        "staff_users",
        "services",
        "quote_wording",
        "quote_counters",
        "organisation_settings",
      ]) {
        for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          expect(await privilege(tx, tablePriv(table, p)), `${p} on ${table}`).toBe(false);
        }
      }
      // contacts: column grants only; no whole-table rights, no insert or delete
      for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        expect(await privilege(tx, tablePriv("contacts", p)), `${p} on contacts`).toBe(false);
      }
      for (const c of [
        "id",
        "customerId",
        "name",
        "role",
        "email",
        "phone",
        "receivesQuotes",
        "portalAccess",
        "portalInvitedAt",
        "portalWelcomedAt",
        "lastSignedInAt",
      ]) {
        expect(await privilege(tx, column("contacts", c, "SELECT")), `select contacts.${c}`).toBe(true);
      }
      for (const c of ["receivesInvoices", "createdAt"]) {
        expect(await privilege(tx, column("contacts", c, "SELECT")), `select contacts.${c}`).toBe(false);
      }
      for (const c of [
        "name",
        "phone",
        "portalAccess",
        "portalInvitedAt",
        "portalWelcomedAt",
        "lastSignedInAt",
        "updatedAt",
      ]) {
        expect(await privilege(tx, column("contacts", c, "UPDATE")), `update contacts.${c}`).toBe(true);
      }
      for (const c of ["email", "role", "customerId", "receivesQuotes", "receivesInvoices"]) {
        expect(await privilege(tx, column("contacts", c, "UPDATE")), `update contacts.${c}`).toBe(false);
      }
      // customers
      for (const c of [
        "id",
        "status",
        "anonymisedAt",
        "displayName",
        "type",
        "companyName",
        "archivedAt",
        "billingLine1",
        "billingPostalCode",
        "consentAt",
        "consentSource",
        "managedById",
        "billsToManager",
      ]) {
        expect(await privilege(tx, column("customers", c, "SELECT")), `select customers.${c}`).toBe(true);
      }
      for (const c of ["notes", "number", "registrationNumber", "sourceNote", "consentNote", "createdById"]) {
        expect(await privilege(tx, column("customers", c, "SELECT")), `select customers.${c}`).toBe(false);
      }
      for (const c of [
        "status",
        "updatedAt",
        "billingLine1",
        "billingLine2",
        "billingSuburb",
        "billingCity",
        "billingPostalCode",
        "consentAt",
        "consentSource",
        "consentNote",
      ]) {
        expect(await privilege(tx, column("customers", c, "UPDATE")), `update customers.${c}`).toBe(true);
      }
      for (const c of [
        "displayName",
        "companyName",
        "notes",
        "type",
        "managedById",
        "billsToManager",
        "anonymisedAt",
        "archivedAt",
      ]) {
        expect(await privilege(tx, column("customers", c, "UPDATE")), `update customers.${c}`).toBe(false);
      }
      // properties: the address is readable, the access notes are not, nothing but the lock column is writable
      for (const c of ["id", "customerId", "archivedAt", "label", "addressLine1", "addressLine2", "suburb", "city", "postalCode"]) {
        expect(await privilege(tx, column("properties", c, "SELECT")), `select properties.${c}`).toBe(true);
      }
      for (const c of ["accessNotes", "mapUrl", "terrainNotes", "lawnSizeSqm"]) {
        expect(await privilege(tx, column("properties", c, "SELECT")), `select properties.${c}`).toBe(false);
      }
      expect(await privilege(tx, column("properties", "updatedAt", "UPDATE"))).toBe(true);
      for (const c of ["label", "addressLine1", "accessNotes"]) {
        expect(await privilege(tx, column("properties", c, "UPDATE")), `update properties.${c}`).toBe(false);
      }
      // audit log: insert plus read of the id only
      expect(await privilege(tx, tablePriv("audit_log", "INSERT"))).toBe(true);
      expect(await privilege(tx, column("audit_log", "id", "SELECT"))).toBe(true);
      for (const c of ["after", "before", "actorId", "ip", "userAgent"]) {
        expect(await privilege(tx, column("audit_log", c, "SELECT")), `select audit_log.${c}`).toBe(false);
      }
      expect(await privilege(tx, tablePriv("audit_log", "UPDATE"))).toBe(false);
      expect(await privilege(tx, tablePriv("audit_log", "DELETE"))).toBe(false);
      // quote lines and scope items
      expect(await privilege(tx, tablePriv("quote_lines", "SELECT"))).toBe(true);
      expect(await privilege(tx, column("quote_lines", "chosen", "UPDATE"))).toBe(true);
      expect(await privilege(tx, column("quote_lines", "amountCents", "UPDATE"))).toBe(false);
      expect(await privilege(tx, tablePriv("quote_lines", "INSERT"))).toBe(false);
      expect(await privilege(tx, tablePriv("quote_scope_items", "SELECT"))).toBe(true);
      expect(await privilege(tx, tablePriv("quote_scope_items", "UPDATE"))).toBe(false);
      // the rate-limit table and the two sign-in tables
      for (const table of ["public_link_hits", "portal_codes", "portal_sessions"]) {
        for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          expect(await privilege(tx, tablePriv(table, p)), `${p} on ${table}`).toBe(true);
        }
      }
    });
```

5e. Replace the `refused` array in the "refused statements" describe with:

```ts
  const refused: [string, string][] = [
    ["reading every contact column", `select * from contacts limit 1`],
    ["reading staff users", `select * from staff_users limit 1`],
    ["reading a customer's internal notes", `select "notes" from customers limit 1`],
    ["reading a property's access notes", `select "accessNotes" from properties limit 1`],
    ["reading the internal note", `select "internalNote" from quotes limit 1`],
    ["reading the audit details", `select "after" from audit_log limit 1`],
    ["changing a customer's name", `update customers set "displayName" = 'x'`],
    ["changing who manages a customer", `update customers set "managedById" = null`],
    ["changing a contact's email", `update contacts set "email" = 'x@example.com'`],
    ["changing a property's access notes", `update properties set "accessNotes" = 'x'`],
    [
      "adding a contact",
      `insert into contacts ("id", "customerId", "name", "updatedAt") values (gen_random_uuid(), gen_random_uuid(), 'x', now())`,
    ],
    ["deleting contacts", `delete from contacts`],
    ["deleting quotes", `delete from quotes`],
    ["deleting audit lines", `delete from audit_log`],
    ["reading the wording table", `select * from quote_wording limit 1`],
  ];
```

(Each entry already runs in its own `withRollback` through the existing loop.)

- [ ] **Step 6: Write `packages/core/src/portal/db-protection.db.test.ts`**

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dbTestsEnabled, withRollback } from "../testing/rollback";

const TABLES = ["portal_codes", "portal_sessions"];

describe.skipIf(!dbTestsEnabled)("portal sign-in tables: database protections", () => {
  it("blocks the public API from reading the sign-in tables", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(url && key).toBeTruthy();
    for (const table of TABLES) {
      const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
        headers: { apikey: key!, Authorization: `Bearer ${key}` },
      });
      expect([401, 403, 404]).toContain(res.status);
    }
  });

  it("has row level security on, and no access for the public roles", async () => {
    await withRollback(async (tx) => {
      const rls = await tx.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
        select relname, relrowsecurity from pg_class where relname in ('portal_codes', 'portal_sessions')`;
      expect(rls.map((r) => r.relname).sort()).toEqual([...TABLES].sort());
      for (const row of rls) expect(row.relrowsecurity, row.relname).toBe(true);
      const roles = await tx.$queryRaw<{ rolname: string }[]>`
        select rolname from pg_roles where rolname in ('authenticated', 'anon')`;
      for (const { rolname } of roles) {
        for (const table of TABLES) {
          for (const p of ["select", "insert", "update", "delete"]) {
            const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`
              select has_table_privilege(${rolname}, ${table}, ${p}) as allowed`;
            expect(row?.allowed, `${rolname} ${p} on ${table}`).toBe(false);
          }
        }
      }
    });
  });

  it("rejects an uppercase email on a sign-in code", async () => {
    await expect(
      withRollback((tx) =>
        tx.portalCode.create({
          data: {
            email: "ZZ.Upper@Example.com",
            codeHash: "x",
            salt: "y",
            expiresAt: new Date(),
          },
        }),
      ),
    ).rejects.toThrow(/portal_codes_email_lowercase/);
  });

  it("rejects an uppercase email on a session", async () => {
    await expect(
      withRollback((tx) =>
        tx.portalSession.create({
          data: {
            tokenHash: randomUUID(),
            email: "ZZ.Upper@Example.com",
            lastSeenAt: new Date(),
            expiresAt: new Date(),
            absoluteExpiresAt: new Date(),
          },
        }),
      ),
    ).rejects.toThrow(/portal_sessions_email_lowercase/);
  });

  it("rejects a customer that manages itself", async () => {
    await expect(
      withRollback(async (tx) => {
        const c = await tx.customer.create({
          data: { type: "COMPANY", displayName: "ZZ E2E Self Manager" },
          select: { id: true },
        });
        await tx.customer.update({ where: { id: c.id }, data: { managedById: c.id } });
      }),
    ).rejects.toThrow(/customers_not_managed_by_itself/);
  });

  it("does not let a customer that still manages a complex be deleted", async () => {
    await expect(
      withRollback(async (tx) => {
        const agency = await tx.customer.create({
          data: { type: "COMPANY", displayName: "ZZ E2E Agency" },
          select: { id: true },
        });
        await tx.customer.create({
          data: { type: "COMPANY", displayName: "ZZ E2E Complex", managedById: agency.id },
        });
        await tx.customer.delete({ where: { id: agency.id } });
      }),
    ).rejects.toThrow(/customers_managedById_fkey|Foreign key constraint/);
  });
});
```

- [ ] **Step 7: Check and commit**

```bash
cd packages/core
npm run db:validate
npm run db:generate
npx vitest run src/customers/privacy-coverage.test.ts
cd ../..
npx prettier --write packages/core/src/quotes/schemas.ts packages/core/src/customers/privacy-coverage.test.ts packages/core/src/quotes/portal-role.db.test.ts packages/core/src/portal/db-protection.db.test.ts
npm run typecheck
npm run lint
npm run test
git add packages/core/prisma/schema.prisma packages/core/prisma/migrations/20261123120000_client_portal/migration.sql packages/core/src/quotes/schemas.ts packages/core/src/customers/privacy-coverage.test.ts packages/core/src/quotes/portal-role.db.test.ts packages/core/src/portal/db-protection.db.test.ts
git commit -m "Add client portal columns, sign-in tables and wider ace_portal grants (migration not yet applied)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: validate, generate, typecheck, lint and unit tests pass (the schema file is not formatted by prettier; `npx prisma format` handles it). Do NOT run `db:deploy` or any database test.

---

### Task 2: Apply the client portal migration (CONTROLLER ONLY, needs the owner's explicit approval)

Not delegated to a subagent.

- [ ] **Step 1: Ask the owner for permission** to apply the migration to the dev database. Say in plain words: it adds a "managed by" link and a "bills go to" switch on customers, three date fields on contacts (invited, welcomed, last signed in), a field on quotes for who accepted in the portal, a new acceptance method "client portal", two small tables for sign-in codes and signed-in sessions, and lets the portal's database login (`ace_portal`, still unable to log in) read and change the few contact, customer and property details the portal needs (never property access notes, staff, services or the history). Nothing existing is changed or deleted. Show the SQL file. Wait for a clear yes.
- [ ] **Step 2: Apply it**

```bash
cd packages/core
npm run db:deploy
```

Expected: migration `20261123120000_client_portal` applied. If Postgres refuses `ALTER TYPE ... ADD VALUE` inside the migration transaction, report the exact error; then (only if the migration was not recorded as applied) move that one statement into its own earlier migration folder `20261123115900_client_portal_accept_method/migration.sql` and retry.

- [ ] **Step 3: Verify** with a throwaway script outside the repo: `ace_portal` is still NOLOGIN; `has_column_privilege('ace_portal','contacts','email','SELECT')` is true; `has_column_privilege('ace_portal','properties','accessNotes','SELECT')` is false; `has_table_privilege('ace_portal','portal_sessions','DELETE')` is true; `relrowsecurity` is true for `portal_codes` and `portal_sessions`; `select enum_range(null::"QuoteAcceptMethod")` ends with `CLIENT_PORTAL`.
- [ ] **Step 4: Run the database tests once** (`npm run test:db`, about 10 minutes). Expected: everything passes, including the updated `portal-role.db.test.ts` and the new `portal/db-protection.db.test.ts`. If the frozen catalogue differs, compare the printed diff with the migration and fix whichever is wrong (a new grant must be in both).

---
### Task 3: Pure portal helpers, per-kind rate limits and the `@ace/core/portal` entry point

**Files:**
- Create: `packages/core/src/portal/email-address.ts`, `email-address.test.ts`
- Create: `packages/core/src/portal/codes.ts`, `codes.test.ts`
- Create: `packages/core/src/portal/session-token.ts`, `session-token.test.ts`
- Create: `packages/core/src/portal/cookies.ts`, `cookies.test.ts`
- Create: `packages/core/src/portal/config.ts`, `config.test.ts`
- Create: `packages/core/src/portal/scope.ts`, `scope.test.ts`
- Create: `packages/core/src/portal/index.ts`
- Modify: `packages/core/src/quotes/rate-limit-window.ts`, `rate-limit-window.test.ts`
- Modify: `packages/core/src/quotes/public.ts` (`checkRateLimit` only)
- Modify: `packages/core/package.json` (new export), `packages/core/src/index.ts`
- Modify: `apps/admin/src/lib/portal-url.ts`

**Interfaces (produced):**
- `email-address.ts`: `normaliseEmail(input: string): string | null` (trimmed, lowercase, a valid address of at most 254 characters, else null); `hashEmail(email: string): string` (64 hex characters, SHA-256 of `"ace-email-v1:" + email`).
- `codes.ts`: `CODE_TTL_MINUTES = 10`; `MAX_CODE_ATTEMPTS = 5`; `generateSignInCode(): string` (6 digits from `crypto.randomInt`); `isSignInCodeShape(value: string): boolean`; `newCodeSalt(): string` (32 hex characters); `hashSignInCode(code: string, salt: string): string` (64 hex); `signInCodeMatches(code: string, salt: string, expectedHash: string): boolean` (constant-time); `codeExpiresAt(now?: Date): Date`.
- `session-token.ts`: `SESSION_SLIDING_DAYS = 30`; `SESSION_ABSOLUTE_DAYS = 90`; `SESSION_TOUCH_MINUTES = 60`; `generateSessionToken(): string` (32 random bytes, base64url, 43 characters); `isSessionTokenShape(value: string): boolean`; `hashSessionToken(token: string): string` (SHA-256 hex); `newSessionTimes(now?: Date): { lastSeenAt: Date; expiresAt: Date; absoluteExpiresAt: Date }`; `slideSessionExpiry(now: Date, absoluteExpiresAt: Date): Date`; `isSessionLive(s: { expiresAt: Date; absoluteExpiresAt: Date }, now?: Date): boolean`; `shouldTouchSession(lastSeenAt: Date, now?: Date): boolean`.
- `cookies.ts`: `type PortalCookieNames = { session: string; pendingEmail: string }`; `portalCookieNames(nodeEnv?: string): PortalCookieNames`; `PENDING_EMAIL_MAX_AGE_SECONDS = 900`.
- `config.ts`: `getPortalBaseUrl(env?: NodeJS.ProcessEnv): string` (no trailing slash; production requires `PORTAL_URL`; development defaults to `http://localhost:3200`); `portalSignInUrl(env?: NodeJS.ProcessEnv): string` (`<base>/sign-in`).
- `scope.ts`: `type ScopeContact = { id: string; customerId: string; name: string; welcomed: boolean }`; `type PortalScope` (branded, read-only: `email`, `contacts`, `ownCustomerIds`, `managedCustomerIds`, `customerIds`); `buildScope(email: string, contacts: readonly ScopeContact[], managed: readonly { id: string; managedById: string }[]): PortalScope | null`; `needsWelcome(scope: PortalScope): boolean`; `pickActingContact(scope: PortalScope, quoteCustomer: { id: string; managedById: string | null }): { contactId: string; customerId: string; forAgency: boolean } | null`. (`buildScope` is NOT exported from any barrel: only `loadPortalScope` in Task 6 and tests may build a scope.)
- `rate-limit-window.ts`: `type RateKind = "view" | "act" | "code-email" | "code-ip"`; `RATE_LIMITS: Record<RateKind, { limit: number; windowMinutes: number }>` (view 120 per 10 min, act 10 per 10 min, code-email 3 per 60 min, code-ip 10 per 60 min); `windowStartFor(now?: Date, windowMinutes?: number): Date`; `rateBucket(kind: RateKind, hash: string): string`. `RATE_WINDOW_MINUTES`, `VIEW_LIMIT`, `ACT_LIMIT` stay.
- `public.ts`: `checkRateLimit(store, kind: RateKind, hash: string, opts?)` now uses `RATE_LIMITS[kind]` (same signature).
- `@ace/core/portal` (new entry point `packages/core/src/portal/index.ts`), and `getPortalBaseUrl`, `portalSignInUrl` also from `@ace/core`.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/portal/email-address.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashEmail, normaliseEmail } from "./email-address";

describe("normaliseEmail", () => {
  it("trims and lowercases a valid address", () => {
    expect(normaliseEmail("  ZZ.Client@Example.COM ")).toBe("zz.client@example.com");
  });
  it("refuses anything that is not an email address", () => {
    for (const bad of ["", "   ", "nobody", "a@", "@example.com", "a b@example.com", `${"a".repeat(250)}@example.com`]) {
      expect(normaliseEmail(bad), bad).toBeNull();
    }
  });
});

describe("hashEmail", () => {
  it("is a stable 64 character hex string that does not contain the address", () => {
    const h = hashEmail("zz.client@example.com");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEmail("zz.client@example.com")).toBe(h);
    expect(hashEmail("zz.other@example.com")).not.toBe(h);
    expect(h).not.toContain("example");
  });
});
```

`packages/core/src/portal/codes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CODE_TTL_MINUTES,
  MAX_CODE_ATTEMPTS,
  codeExpiresAt,
  generateSignInCode,
  hashSignInCode,
  isSignInCodeShape,
  newCodeSalt,
  signInCodeMatches,
} from "./codes";

describe("sign-in codes", () => {
  it("are six digits, and vary", () => {
    const codes = Array.from({ length: 40 }, () => generateSignInCode());
    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    expect(new Set(codes).size).toBeGreaterThan(30);
  });
  it("recognise only six digits", () => {
    expect(isSignInCodeShape("012345")).toBe(true);
    for (const bad of ["", "12345", "1234567", "12a456", " 12345", "12 345"]) {
      expect(isSignInCodeShape(bad), bad).toBe(false);
    }
  });
  it("are stored as a salted hash that never contains the code", () => {
    const salt = newCodeSalt();
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(newCodeSalt()).not.toBe(salt);
    const hash = hashSignInCode("123456", salt);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("123456");
    expect(hashSignInCode("123456", newCodeSalt())).not.toBe(hash);
  });
  it("match only the right code with the right salt", () => {
    const salt = newCodeSalt();
    const hash = hashSignInCode("654321", salt);
    expect(signInCodeMatches("654321", salt, hash)).toBe(true);
    expect(signInCodeMatches("654320", salt, hash)).toBe(false);
    expect(signInCodeMatches("654321", newCodeSalt(), hash)).toBe(false);
    // a damaged stored hash (wrong length, not hex) is a mismatch, never an exception
    expect(signInCodeMatches("654321", salt, "abc")).toBe(false);
    expect(signInCodeMatches("654321", salt, "z".repeat(64))).toBe(false);
  });
  it("last ten minutes and die after five wrong tries", () => {
    expect(CODE_TTL_MINUTES).toBe(10);
    expect(MAX_CODE_ATTEMPTS).toBe(5);
    const now = new Date("2026-11-23T08:00:00.000Z");
    expect(codeExpiresAt(now).toISOString()).toBe("2026-11-23T08:10:00.000Z");
  });
});
```

`packages/core/src/portal/session-token.test.ts`:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  hashSessionToken,
  isSessionLive,
  isSessionTokenShape,
  newSessionTimes,
  shouldTouchSession,
  slideSessionExpiry,
} from "./session-token";

const DAY = 86_400_000;
const now = new Date("2026-11-23T08:00:00.000Z");

describe("session tokens", () => {
  it("are 43 URL-safe characters, different every time", () => {
    const a = generateSessionToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isSessionTokenShape(a)).toBe(true);
    expect(generateSessionToken()).not.toBe(a);
    for (const bad of ["", "x".repeat(42), "x".repeat(44), `${"a".repeat(42)}!`]) {
      expect(isSessionTokenShape(bad), bad).toBe(false);
    }
  });
  it("are stored only as their SHA-256", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashSessionToken(token)).not.toContain(token);
  });
});

describe("session expiry", () => {
  it("starts with 30 sliding days and 90 absolute days", () => {
    const t = newSessionTimes(now);
    expect(t.lastSeenAt).toEqual(now);
    expect(t.expiresAt.getTime() - now.getTime()).toBe(30 * DAY);
    expect(t.absoluteExpiresAt.getTime() - now.getTime()).toBe(90 * DAY);
  });
  it("slides 30 days from the last use but never past the absolute end", () => {
    const absolute = new Date(now.getTime() + 90 * DAY);
    expect(slideSessionExpiry(new Date(now.getTime() + 10 * DAY), absolute).getTime()).toBe(
      now.getTime() + 40 * DAY,
    );
    expect(slideSessionExpiry(new Date(now.getTime() + 80 * DAY), absolute)).toEqual(absolute);
  });
  it("is live only before both ends", () => {
    const s = { expiresAt: new Date(now.getTime() + DAY), absoluteExpiresAt: new Date(now.getTime() + 2 * DAY) };
    expect(isSessionLive(s, now)).toBe(true);
    expect(isSessionLive(s, new Date(now.getTime() + DAY))).toBe(false);
    expect(isSessionLive({ ...s, absoluteExpiresAt: now }, now)).toBe(false);
  });
  it("touches the session at most once an hour", () => {
    expect(shouldTouchSession(now, new Date(now.getTime() + 59 * 60_000))).toBe(false);
    expect(shouldTouchSession(now, new Date(now.getTime() + 60 * 60_000))).toBe(true);
  });
});
```

`packages/core/src/portal/cookies.test.ts`:

```ts
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
```

`packages/core/src/portal/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getPortalBaseUrl, portalSignInUrl } from "./config";

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

describe("portal address", () => {
  it("uses PORTAL_URL without a trailing slash", () => {
    expect(getPortalBaseUrl(env({ NODE_ENV: "production", PORTAL_URL: "https://portal.example.com/" }))).toBe(
      "https://portal.example.com",
    );
    expect(portalSignInUrl(env({ NODE_ENV: "production", PORTAL_URL: "https://portal.example.com" }))).toBe(
      "https://portal.example.com/sign-in",
    );
  });
  it("defaults to the local portal in development", () => {
    expect(getPortalBaseUrl(env({ NODE_ENV: "development" }))).toBe("http://localhost:3200");
  });
  it("refuses to guess in production", () => {
    expect(() => getPortalBaseUrl(env({ NODE_ENV: "production" }))).toThrow("PORTAL_URL is not set.");
  });
});
```

`packages/core/src/portal/scope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildScope, needsWelcome, pickActingContact, type ScopeContact } from "./scope";

const agency = "a0000000-0000-4000-8000-000000000001";
const complexX = "c0000000-0000-4000-8000-000000000001";
const complexY = "c0000000-0000-4000-8000-000000000002";
const stranger = "f0000000-0000-4000-8000-000000000001";

const contact = (id: string, customerId: string, welcomed = true): ScopeContact => ({
  id,
  customerId,
  name: `ZZ Contact ${id.slice(0, 4)}`,
  welcomed,
});

describe("buildScope", () => {
  it("is null when the email has no contact with access", () => {
    expect(buildScope("zz@example.com", [], [])).toBeNull();
  });
  it("adds the complexes an own customer manages, one level only", () => {
    const scope = buildScope(
      "zz@example.com",
      [contact("1", agency)],
      [
        { id: complexX, managedById: agency },
        { id: complexY, managedById: agency },
        // managed by someone else: ignored even if passed in
        { id: stranger, managedById: complexX },
      ],
    );
    expect(scope?.ownCustomerIds).toEqual([agency]);
    expect(scope?.managedCustomerIds).toEqual([complexX, complexY]);
    expect(scope?.customerIds).toEqual([agency, complexX, complexY].sort());
  });
  it("counts a customer that is both own and managed as own", () => {
    const scope = buildScope(
      "zz@example.com",
      [contact("1", agency), contact("2", complexX)],
      [{ id: complexX, managedById: agency }],
    );
    expect(scope?.ownCustomerIds).toEqual([agency, complexX].sort());
    expect(scope?.managedCustomerIds).toEqual([]);
  });
});

describe("needsWelcome", () => {
  it("is true while any contact is not welcomed", () => {
    expect(needsWelcome(buildScope("zz@example.com", [contact("1", agency)], [])!)).toBe(false);
    expect(
      needsWelcome(buildScope("zz@example.com", [contact("1", agency), contact("2", complexX, false)], [])!),
    ).toBe(true);
  });
});

describe("pickActingContact", () => {
  const scope = buildScope(
    "zz@example.com",
    [contact("agency-contact", agency), contact("trustee", complexY)],
    [{ id: complexX, managedById: agency }],
  )!;
  it("uses the contact of the quote's own customer first", () => {
    expect(pickActingContact(scope, { id: complexY, managedById: agency })).toEqual({
      contactId: "trustee",
      customerId: complexY,
      forAgency: false,
    });
  });
  it("falls back to the managing agency's contact, recorded as for the agency", () => {
    expect(pickActingContact(scope, { id: complexX, managedById: agency })).toEqual({
      contactId: "agency-contact",
      customerId: agency,
      forAgency: true,
    });
  });
  it("finds nobody for an unrelated customer", () => {
    expect(pickActingContact(scope, { id: stranger, managedById: null })).toBeNull();
    expect(pickActingContact(scope, { id: stranger, managedById: complexX })).toBeNull();
  });
});
```

Replace `packages/core/src/quotes/rate-limit-window.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { RATE_LIMITS, rateBucket, windowStartFor } from "./rate-limit-window";

describe("rate limit windows", () => {
  it("rounds down to the start of the 10 minute window in UTC", () => {
    expect(windowStartFor(new Date("2026-11-21T10:07:31.500Z")).toISOString()).toBe(
      "2026-11-21T10:00:00.000Z",
    );
    expect(windowStartFor(new Date("2026-11-21T10:10:00.000Z")).toISOString()).toBe(
      "2026-11-21T10:10:00.000Z",
    );
    expect(windowStartFor(new Date("2026-11-21T10:19:59.999Z")).toISOString()).toBe(
      "2026-11-21T10:10:00.000Z",
    );
  });
  it("rounds down to the hour for the sign-in code limits", () => {
    expect(windowStartFor(new Date("2026-11-23T10:59:59.000Z"), 60).toISOString()).toBe(
      "2026-11-23T10:00:00.000Z",
    );
  });
  it("keeps every kind in its own bucket", () => {
    expect(rateBucket("view", "abc")).toBe("view:abc");
    expect(rateBucket("act", "abc")).toBe("act:abc");
    expect(rateBucket("code-email", "abc")).toBe("code-email:abc");
    expect(rateBucket("code-ip", "abc")).toBe("code-ip:abc");
  });
  it("allows 3 code requests per email and 10 per visitor per hour", () => {
    expect(RATE_LIMITS["code-email"]).toEqual({ limit: 3, windowMinutes: 60 });
    expect(RATE_LIMITS["code-ip"]).toEqual({ limit: 10, windowMinutes: 60 });
    expect(RATE_LIMITS.view).toEqual({ limit: 120, windowMinutes: 10 });
    expect(RATE_LIMITS.act).toEqual({ limit: 10, windowMinutes: 10 });
  });
});
```

Run (from `packages/core`): `npx vitest run src/portal src/quotes/rate-limit-window.test.ts`. Expected: FAIL (modules missing, `RATE_LIMITS` not exported).

- [ ] **Step 2: Write the code**

`packages/core/src/portal/email-address.ts`:

```ts
import { createHash } from "node:crypto";
import { z } from "zod";

const EMAIL = z.email();

/** Trimmed and lowercase, or null when it is not a valid email address (or is longer than 254). */
export function normaliseEmail(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (value.length === 0 || value.length > 254) return null;
  return EMAIL.safeParse(value).success ? value : null;
}

/** The email as a hash, for the rate limiter, which never keeps the address itself. */
export function hashEmail(email: string): string {
  return createHash("sha256").update(`ace-email-v1:${email}`).digest("hex");
}
```

`packages/core/src/portal/codes.ts`:

```ts
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** A sign-in code works for this long. */
export const CODE_TTL_MINUTES = 10;
/** After this many wrong tries a code is dead. */
export const MAX_CODE_ATTEMPTS = 5;

/** Six digits from a secure random source ("000000" to "999999"). */
export function generateSignInCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function isSignInCodeShape(value: string): boolean {
  return /^\d{6}$/.test(value);
}

export function newCodeSalt(): string {
  return randomBytes(16).toString("hex");
}

/** Only this hash (with its salt) is stored; the code itself never is. */
export function hashSignInCode(code: string, salt: string): string {
  return createHash("sha256").update(`ace-code-v1:${salt}:${code}`).digest("hex");
}

/** Compares in constant time. A damaged stored hash is simply a mismatch. */
export function signInCodeMatches(code: string, salt: string, expectedHash: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(hashSignInCode(code, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function codeExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + CODE_TTL_MINUTES * 60_000);
}
```

`packages/core/src/portal/session-token.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

export const SESSION_SLIDING_DAYS = 30;
export const SESSION_ABSOLUTE_DAYS = 90;
/** The session row is touched (last seen, sliding end) at most this often. */
export const SESSION_TOUCH_MINUTES = 60;

const DAY_MS = 86_400_000;

/** 32 random bytes as base64url: the cookie value. Never stored. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isSessionTokenShape(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** What the database keeps instead of the cookie value. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionTimes(now: Date = new Date()) {
  return {
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + SESSION_SLIDING_DAYS * DAY_MS),
    absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_DAYS * DAY_MS),
  };
}

/** 30 days after this use, but never past the absolute end. */
export function slideSessionExpiry(now: Date, absoluteExpiresAt: Date): Date {
  return new Date(
    Math.min(now.getTime() + SESSION_SLIDING_DAYS * DAY_MS, absoluteExpiresAt.getTime()),
  );
}

export function isSessionLive(
  s: { expiresAt: Date; absoluteExpiresAt: Date },
  now: Date = new Date(),
): boolean {
  return now.getTime() < s.expiresAt.getTime() && now.getTime() < s.absoluteExpiresAt.getTime();
}

export function shouldTouchSession(lastSeenAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastSeenAt.getTime() >= SESSION_TOUCH_MINUTES * 60_000;
}
```

`packages/core/src/portal/cookies.ts`:

```ts
export type PortalCookieNames = { session: string; pendingEmail: string };

/**
 * Production cookies carry the `__Host-` prefix (the browser then insists on secure, path "/" and no
 * domain). Development runs over plain http, so the names are plain there.
 */
export function portalCookieNames(nodeEnv: string | undefined = process.env.NODE_ENV): PortalCookieNames {
  return nodeEnv === "production"
    ? { session: "__Host-ace-portal", pendingEmail: "__Host-ace-portal-email" }
    : { session: "ace-portal", pendingEmail: "ace-portal-email" };
}

/** The typed email is remembered between the two sign-in pages for this long. */
export const PENDING_EMAIL_MAX_AGE_SECONDS = 15 * 60;
```

`packages/core/src/portal/config.ts`:

```ts
import { requireEnv } from "../env";

/** Where the client portal lives (no trailing slash). In development it defaults to the local portal. */
export function getPortalBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value =
    env.NODE_ENV === "production"
      ? requireEnv("PORTAL_URL", env)
      : env.PORTAL_URL || "http://localhost:3200";
  return value.replace(/\/+$/, "");
}

/** The portal's sign-in page. The welcome email links here; there is no secret in the link. */
export function portalSignInUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${getPortalBaseUrl(env)}/sign-in`;
}
```

`packages/core/src/portal/scope.ts`:

```ts
declare const SCOPE_BRAND: unique symbol;

/** One contact the signed-in email belongs to (portal access on, customer neither archived nor anonymised). */
export type ScopeContact = { id: string; customerId: string; name: string; welcomed: boolean };

/**
 * What a signed-in email may see, computed from live data on every request. Branded so that only
 * `loadPortalScope` (and tests) can make one: portal functions take a scope instead of a staff Actor.
 */
export type PortalScope = {
  readonly email: string;
  readonly contacts: readonly ScopeContact[];
  /** The customers of the contacts. */
  readonly ownCustomerIds: readonly string[];
  /** Customers managed by an own customer (complexes seen through their agency). */
  readonly managedCustomerIds: readonly string[];
  /** Own plus managed: every customer whose quotes and properties may be shown. Sorted. */
  readonly customerIds: readonly string[];
  readonly [SCOPE_BRAND]: true;
};

/**
 * Builds the visible set from the contacts with access and the customers that name one of their customers
 * as manager. One level only: an entry whose manager is not an own customer is ignored. Null when there
 * is no contact (the session is then not valid).
 */
export function buildScope(
  email: string,
  contacts: readonly ScopeContact[],
  managed: readonly { id: string; managedById: string }[],
): PortalScope | null {
  if (contacts.length === 0) return null;
  const own = [...new Set(contacts.map((c) => c.customerId))].sort();
  const ownSet = new Set(own);
  const managedIds = [
    ...new Set(
      managed.filter((m) => ownSet.has(m.managedById) && !ownSet.has(m.id)).map((m) => m.id),
    ),
  ].sort();
  const scope = {
    email,
    contacts: [...contacts],
    ownCustomerIds: own,
    managedCustomerIds: managedIds,
    customerIds: [...own, ...managedIds].sort(),
  };
  return scope as unknown as PortalScope;
}

/** True while any of the person's contacts has not completed the welcome page. */
export function needsWelcome(scope: PortalScope): boolean {
  return scope.contacts.some((c) => !c.welcomed);
}

/**
 * Who is acting on a quote of `quoteCustomer`: the person's contact at that customer if there is one,
 * otherwise their contact at the customer's managing agency (recorded as done for the agency).
 */
export function pickActingContact(
  scope: PortalScope,
  quoteCustomer: { id: string; managedById: string | null },
): { contactId: string; customerId: string; forAgency: boolean } | null {
  const own = scope.contacts.find((c) => c.customerId === quoteCustomer.id);
  if (own) return { contactId: own.id, customerId: own.customerId, forAgency: false };
  if (!quoteCustomer.managedById) return null;
  const agency = scope.contacts.find((c) => c.customerId === quoteCustomer.managedById);
  return agency ? { contactId: agency.id, customerId: agency.customerId, forAgency: true } : null;
}
```

Replace `packages/core/src/quotes/rate-limit-window.ts` with:

```ts
export const RATE_WINDOW_MINUTES = 10;
/** Page views and PDF downloads per visitor per window. */
export const VIEW_LIMIT = 120;
/** Accept or decline attempts (and sign-in code checks) per visitor per window. */
export const ACT_LIMIT = 10;

export type RateKind = "view" | "act" | "code-email" | "code-ip";

/** How many requests of each kind one bucket may make in one window, and how long the window is. */
export const RATE_LIMITS: Record<RateKind, { limit: number; windowMinutes: number }> = {
  view: { limit: VIEW_LIMIT, windowMinutes: RATE_WINDOW_MINUTES },
  act: { limit: ACT_LIMIT, windowMinutes: RATE_WINDOW_MINUTES },
  // Sign-in code requests: per email address (hashed) and per visitor (hashed address), per hour.
  "code-email": { limit: 3, windowMinutes: 60 },
  "code-ip": { limit: 10, windowMinutes: 60 },
};

export function windowStartFor(
  now: Date = new Date(),
  windowMinutes: number = RATE_WINDOW_MINUTES,
): Date {
  const ms = windowMinutes * 60_000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

/** The rate-limit row key. `hash` is always a hash (of an address or an email), never the value itself. */
export function rateBucket(kind: RateKind, hash: string): string {
  return `${kind}:${hash}`;
}
```

In `packages/core/src/quotes/public.ts`:
- change the import from `./rate-limit-window` to `import { RATE_LIMITS, rateBucket, windowStartFor, type RateKind } from "./rate-limit-window";` (`ACT_LIMIT` and `VIEW_LIMIT` are no longer used here);
- in `checkRateLimit`, rename the third parameter from `ipHash` to `hash` (update its one use in `rateBucket(kind, hash)`), replace `const windowStart = windowStartFor(now);` with

```ts
  const rule = RATE_LIMITS[kind];
  const windowStart = windowStartFor(now, rule.windowMinutes);
```

and replace the final `return { allowed: count <= (kind === "view" ? VIEW_LIMIT : ACT_LIMIT) };` with `return { allowed: count <= rule.limit };`;
- change the first line of its doc comment to `Counts one request for this bucket (a hashed visitor address or a hashed email) in the current window of its kind, with one atomic statement, and says whether it is still within the limit.`

`packages/core/src/portal/index.ts`:

```ts
// The client portal's entry point: `@ace/core/portal`. Only the portal app imports from here.
// Functions exported here take a PortalScope (computed from the signed-in session), never a staff Actor,
// so they are deliberately NOT exported from the main `@ace/core` barrel.
export { CODE_TTL_MINUTES, MAX_CODE_ATTEMPTS } from "./codes";
export { getPortalBaseUrl, portalSignInUrl } from "./config";
export { PENDING_EMAIL_MAX_AGE_SECONDS, portalCookieNames, type PortalCookieNames } from "./cookies";
export { normaliseEmail } from "./email-address";
export { needsWelcome, type PortalScope, type ScopeContact } from "./scope";
```

`packages/core/package.json`: in `"exports"`, add `"./portal": "./src/portal/index.ts"` after `"./client"`.

`packages/core/src/index.ts`: add the line `export { getPortalBaseUrl, portalSignInUrl } from "./portal/config";` after `export { getDatabaseUrl, requireEnv } from "./env";`.

Replace `apps/admin/src/lib/portal-url.ts` with:

```ts
import "server-only";
import { getPortalBaseUrl } from "@ace/core";

/** Where the client portal lives (no trailing slash). In development it defaults to the local portal. */
export function getPortalUrl(): string {
  return getPortalBaseUrl();
}
```

- [ ] **Step 3: Run the tests, check and commit**

```bash
cd packages/core && npx vitest run src/portal src/quotes/rate-limit-window.test.ts && cd ../..
npx prettier --write packages/core/src/portal packages/core/src/quotes/rate-limit-window.ts packages/core/src/quotes/rate-limit-window.test.ts packages/core/src/quotes/public.ts packages/core/src/index.ts packages/core/package.json apps/admin/src/lib/portal-url.ts
npm run typecheck
npm run lint
npm run test
git add packages/core/src/portal packages/core/src/quotes/rate-limit-window.ts packages/core/src/quotes/rate-limit-window.test.ts packages/core/src/quotes/public.ts packages/core/src/index.ts packages/core/package.json apps/admin/src/lib/portal-url.ts
git commit -m "Add pure client portal helpers, per-kind rate limits and the @ace/core/portal entry point

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: all pass. (`git add packages/core/src/portal` also stages `db-protection.db.test.ts` only if it changed; it did not.)

---

### Task 4: The email module (Resend over `fetch`) and the two emails

**Files:**
- Create: `packages/core/src/portal/email/send.ts`, `send.test.ts`
- Create: `packages/core/src/portal/email/templates.ts`, `templates.test.ts`
- Modify: `packages/core/src/portal/index.ts`, `packages/core/src/index.ts`

**Interfaces (produced):**
- `send.ts`: `type EmailMessage = { to: string; subject: string; text: string; html: string }`; `type EmailDriver = { kind: "resend"; apiKey: string; from: string } | { kind: "console" }`; `emailDriver(env?: NodeJS.ProcessEnv): EmailDriver` (throws `RESEND_API_KEY is not set. In production emails must be sent through Resend.` in production without a key; throws `EMAIL_FROM is not set. It is needed to send emails through Resend.` when a key is set without a sender); `sendEmail(message: EmailMessage, opts?: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; log?: (text: string) => void }): Promise<void>` (development without a key: prints the email with `console.info` and sends nothing; otherwise POSTs to `https://api.resend.com/emails` and throws `The email could not be sent (Resend answered <status>).` on a non-2xx answer; the error never contains the recipient).
- `templates.ts`: `SIGN_IN_SUBJECT = "Your ACE sign-in code"`; `WELCOME_SUBJECT = "Welcome to the ACE client portal"`; `escapeHtml(value: string): string`; `signInCodeEmail(input: { to: string; code: string }): EmailMessage`; `welcomeEmail(input: { to: string; name: string; signInUrl: string }): EmailMessage`.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/portal/email/send.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { emailDriver, sendEmail, type EmailMessage } from "./send";

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
const message: EmailMessage = {
  to: "zz.client@example.com",
  subject: "Your ACE sign-in code",
  text: "Your code is 123456",
  html: "<p>Your code is 123456</p>",
};

describe("emailDriver", () => {
  it("prints to the console in development when there is no key", () => {
    expect(emailDriver(env({ NODE_ENV: "development" }))).toEqual({ kind: "console" });
  });
  it("fails loudly in production without a key", () => {
    expect(() => emailDriver(env({ NODE_ENV: "production" }))).toThrow(
      "RESEND_API_KEY is not set. In production emails must be sent through Resend.",
    );
  });
  it("needs a sender when a key is set", () => {
    expect(() => emailDriver(env({ NODE_ENV: "production", RESEND_API_KEY: "re_test" }))).toThrow(
      "EMAIL_FROM is not set. It is needed to send emails through Resend.",
    );
    expect(
      emailDriver(env({ NODE_ENV: "production", RESEND_API_KEY: "re_test", EMAIL_FROM: "ACE <noreply@example.com>" })),
    ).toEqual({ kind: "resend", apiKey: "re_test", from: "ACE <noreply@example.com>" });
  });
});

describe("sendEmail", () => {
  it("in development prints the email and never calls the network", async () => {
    const fetchImpl = vi.fn();
    const log = vi.fn();
    await sendEmail(message, {
      env: env({ NODE_ENV: "development" }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain("123456");
    expect(String(log.mock.calls[0]?.[0])).toContain("not sent");
  });

  it("posts the email to Resend with the key and the sender", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
    await sendEmail(message, {
      env: env({ NODE_ENV: "production", RESEND_API_KEY: "re_test", EMAIL_FROM: "ACE <noreply@example.com>" }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(init.body))).toEqual({
      from: "ACE <noreply@example.com>",
      to: ["zz.client@example.com"],
      subject: "Your ACE sign-in code",
      text: "Your code is 123456",
      html: "<p>Your code is 123456</p>",
    });
  });

  it("throws on a refusal without putting the address in the error", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 422 }));
    const error = await sendEmail(message, {
      env: env({ NODE_ENV: "production", RESEND_API_KEY: "re_test", EMAIL_FROM: "ACE <noreply@example.com>" }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("The email could not be sent (Resend answered 422).");
    expect((error as Error).message).not.toContain("example.com");
  });
});
```

`packages/core/src/portal/email/templates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SIGN_IN_SUBJECT, WELCOME_SUBJECT, escapeHtml, signInCodeEmail, welcomeEmail } from "./templates";

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
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
```

Run `cd packages/core && npx vitest run src/portal/email && cd ../..`: expect FAIL (modules missing).

- [ ] **Step 2: Write the code**

`packages/core/src/portal/email/send.ts`:

```ts
export type EmailMessage = { to: string; subject: string; text: string; html: string };

export type EmailDriver = { kind: "resend"; apiKey: string; from: string } | { kind: "console" };

const RESEND_URL = "https://api.resend.com/emails";

/**
 * How email goes out. With RESEND_API_KEY: through Resend (EMAIL_FROM is then required). Without it:
 * printed to the server console in development, and a loud failure in production.
 */
export function emailDriver(env: NodeJS.ProcessEnv = process.env): EmailDriver {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (apiKey) {
    const from = env.EMAIL_FROM?.trim();
    if (!from) throw new Error("EMAIL_FROM is not set. It is needed to send emails through Resend.");
    return { kind: "resend", apiKey, from };
  }
  if (env.NODE_ENV === "production") {
    throw new Error("RESEND_API_KEY is not set. In production emails must be sent through Resend.");
  }
  return { kind: "console" };
}

/** Sends one email. The error, if any, never contains the recipient's address. */
export async function sendEmail(
  message: EmailMessage,
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; log?: (text: string) => void } = {},
): Promise<void> {
  const driver = emailDriver(opts.env);
  if (driver.kind === "console") {
    (opts.log ?? console.info)(
      `[email: development only, not sent]\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
    );
    return;
  }
  const res = await (opts.fetchImpl ?? fetch)(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${driver.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: driver.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`The email could not be sent (Resend answered ${res.status}).`);
}
```

`packages/core/src/portal/email/templates.ts`:

```ts
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
```

Exports. Append to `packages/core/src/portal/index.ts`:

```ts
export { sendEmail, type EmailMessage } from "./email/send";
export { signInCodeEmail, welcomeEmail } from "./email/templates";
```

and add to `packages/core/src/index.ts` (after the `./portal/config` line):

```ts
export { sendEmail, type EmailMessage } from "./portal/email/send";
export { signInCodeEmail, welcomeEmail } from "./portal/email/templates";
```

- [ ] **Step 3: Run the tests, check and commit**

```bash
cd packages/core && npx vitest run src/portal/email && cd ../..
npx prettier --write packages/core/src/portal/email packages/core/src/portal/index.ts packages/core/src/index.ts
npm run typecheck
npm run lint
npm run test
git add packages/core/src/portal/email packages/core/src/portal/index.ts packages/core/src/index.ts
git commit -m "Add the email module (Resend over fetch, console in development) and the two portal emails

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: all pass.

---
### Task 5: Managing-agency rules (staff), and anonymise for the portal

**Files:**
- Create: `packages/core/src/portal/hierarchy.ts`, `packages/core/src/portal/hierarchy.db.test.ts`
- Create: `packages/core/src/portal/end-sign-ins.ts`
- Create: `packages/core/src/portal/anonymise.db.test.ts`
- Modify: `packages/core/src/customers/store.ts` (`Store` gains the two sign-in tables)
- Modify: `packages/core/src/customers/privacy.ts` (`anonymiseCustomer`)
- Modify: `packages/core/src/customers/privacy-order.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `assertRole`, `DomainError`, `MANAGEMENT`, `Actor` (`customers/access.ts`); `findEditableCustomer`, `lockCustomer`, `logCustomerEvent`, `Store` (`customers/store.ts`); `exportCustomerData`, `anonymiseCustomer` (`customers/privacy.ts`); `owner`, `manager`, `crew` (`quotes/test-helpers.ts`).
- Produces (`portal/hierarchy.ts`, staff-facing, exported from `@ace/core`):
  - `HIERARCHY_MESSAGES` (const object; keys `self`, `agencyMissing`, `agencyAnonymised`, `agencyArchived`, `agencyIsManaged`, `complexManagesOthers`, `notManaged`, `agencyStillManages`) and `type HierarchyMessageKey = keyof typeof HIERARCHY_MESSAGES`.
  - `setManagedBy(store: Store, actor: Actor, complexId: string, agencyId: string): Promise<void>`
  - `clearManagedBy(store: Store, actor: Actor, complexId: string): Promise<void>`
  - `setBillsToManager(store: Store, actor: Actor, complexId: string, billsToManager: boolean): Promise<void>`
  - `type CustomerHierarchy = { manager: { id: string; number: number; displayName: string } | null; billsToManager: boolean; complexes: { id: string; number: number; displayName: string; status: CustomerStatus; propertyCount: number; quoteCount: number }[] }`
  - `getCustomerHierarchy(store: Store, actor: Actor, customerId: string): Promise<CustomerHierarchy>`
  - `type AgencyOption = { id: string; number: number; displayName: string }`
  - `searchAgencies(store: Store, actor: Actor, query: { q: string; excludeId: string }): Promise<AgencyOption[]>`
- Produces (`portal/end-sign-ins.ts`, not exported from any barrel; imported directly by `customers/privacy.ts` here and by `customers/contacts.ts` and `portal/access.ts` in Task 9): `endPortalSignIns(store: Pick<Db, "contact" | "portalCode" | "portalSession">, emails: readonly string[], exceptContactIds: readonly string[]): Promise<number>`.
- Changes: `Store` (customers) = `Pick<Db, "customer" | "contact" | "property" | "auditLog" | "staffUser" | "quote" | "portalCode" | "portalSession">`. `anonymiseCustomer` refuses an agency that still manages complexes (`HIERARCHY_MESSAGES.agencyStillManages`), ends the portal sign-ins of the customer's contacts, clears the portal dates on its contacts and clears its own Managed by link.

Audit actions written here (entity type `customer`, `after` holds ids and fixed values only): `customer.manager_set` `{ managerId, previousManagerId }` on the complex; `customer.complex_added` `{ complexId }` on the new agency; `customer.complex_removed` `{ complexId }` on the previous agency; `customer.manager_cleared` `{ previousManagerId }` on the complex; `customer.bills_to_changed` `{ billsToManager }` on the complex.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/portal/hierarchy.db.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../customers/access";
import { archiveCustomer, createCustomer } from "../customers/customers";
import { formatCustomerNumber } from "../customers/number";
import { anonymiseCustomer } from "../customers/privacy";
import { contactSchema, customerSchema } from "../customers/schemas";
import { crew, manager, owner } from "../quotes/test-helpers";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import {
  HIERARCHY_MESSAGES,
  clearManagedBy,
  getCustomerHierarchy,
  searchAgencies,
  setBillsToManager,
  setManagedBy,
} from "./hierarchy";

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];
const tok = () => randomUUID().replaceAll("-", "").slice(0, 10);

async function company(tx: Tx, name = `ZZ E2E Company ${tok()}`) {
  const { id, number } = await createCustomer(tx, manager, {
    customer: customerSchema.parse({ type: "COMPANY", displayName: name, status: "ACTIVE" }),
    contact: contactSchema.parse({ name: "ZZ E2E Contact", email: `${randomUUID()}@example.com` }),
  });
  return { id, number, name };
}

const audit = (tx: Tx, entityId: string, action: string) =>
  tx.auditLog.findMany({ where: { entityType: "customer", entityId, action }, orderBy: { at: "asc" } });

describe.skipIf(!dbTestsEnabled)("managing agencies: the link rules", () => {
  it("links a complex to an agency, shows it on both sides, and audits ids only", async () => {
    await withRollback(async (tx) => {
      const agency = await company(tx);
      const complex = await company(tx);
      await setManagedBy(tx, manager, complex.id, agency.id);

      const row = await tx.customer.findUniqueOrThrow({ where: { id: complex.id } });
      expect(row).toMatchObject({ managedById: agency.id, billsToManager: true });
      expect((await getCustomerHierarchy(tx, manager, complex.id)).manager).toEqual({
        id: agency.id,
        number: agency.number,
        displayName: agency.name,
      });
      const fromAgency = await getCustomerHierarchy(tx, manager, agency.id);
      expect(fromAgency.manager).toBeNull();
      expect(fromAgency.complexes).toEqual([
        {
          id: complex.id,
          number: complex.number,
          displayName: complex.name,
          status: "ACTIVE",
          propertyCount: 0,
          quoteCount: 0,
        },
      ]);

      const set = await audit(tx, complex.id, "customer.manager_set");
      expect(set).toHaveLength(1);
      expect(set[0]?.after).toEqual({ managerId: agency.id, previousManagerId: null });
      const added = await audit(tx, agency.id, "customer.complex_added");
      expect(added[0]?.after).toEqual({ complexId: complex.id });
      const text = JSON.stringify([...set, ...added]);
      expect(text).not.toContain(agency.name);
      expect(text).not.toContain(complex.name);

      // Linking again to the same agency changes nothing and writes nothing.
      await setManagedBy(tx, manager, complex.id, agency.id);
      expect(await audit(tx, complex.id, "customer.manager_set")).toHaveLength(1);
    });
  });

  it("moves a complex to another agency, switches who is billed, and clears the link", async () => {
    await withRollback(async (tx) => {
      const first = await company(tx);
      const second = await company(tx);
      const complex = await company(tx);
      await setManagedBy(tx, manager, complex.id, first.id);
      await setBillsToManager(tx, manager, complex.id, false);
      expect((await tx.customer.findUniqueOrThrow({ where: { id: complex.id } })).billsToManager).toBe(false);
      expect((await audit(tx, complex.id, "customer.bills_to_changed"))[0]?.after).toEqual({
        billsToManager: false,
      });

      await setManagedBy(tx, owner, complex.id, second.id);
      const moved = await audit(tx, complex.id, "customer.manager_set");
      expect(moved[1]?.after).toEqual({ managerId: second.id, previousManagerId: first.id });
      expect((await audit(tx, first.id, "customer.complex_removed"))[0]?.after).toEqual({
        complexId: complex.id,
      });

      await clearManagedBy(tx, manager, complex.id);
      const cleared = await tx.customer.findUniqueOrThrow({ where: { id: complex.id } });
      expect(cleared).toMatchObject({ managedById: null, billsToManager: true });
      expect((await audit(tx, complex.id, "customer.manager_cleared"))[0]?.after).toEqual({
        previousManagerId: second.id,
      });
      // Clearing again does nothing; the switch needs a link.
      await clearManagedBy(tx, manager, complex.id);
      expect(await audit(tx, complex.id, "customer.manager_cleared")).toHaveLength(1);
      await expect(setBillsToManager(tx, manager, complex.id, false)).rejects.toThrow(
        HIERARCHY_MESSAGES.notManaged,
      );
    });
  });

  it("refuses self links, chains and cycles", async () => {
    await withRollback(async (tx) => {
      const agency = await company(tx);
      const complex = await company(tx);
      const other = await company(tx);
      await expect(setManagedBy(tx, manager, agency.id, agency.id)).rejects.toThrow(HIERARCHY_MESSAGES.self);
      await setManagedBy(tx, manager, complex.id, agency.id);
      // the complex is managed, so it cannot be an agency (no chains)
      await expect(setManagedBy(tx, manager, other.id, complex.id)).rejects.toThrow(
        HIERARCHY_MESSAGES.agencyIsManaged,
      );
      // the agency manages a complex, so it cannot be managed (no chains)
      await expect(setManagedBy(tx, manager, agency.id, other.id)).rejects.toThrow(
        HIERARCHY_MESSAGES.complexManagesOthers,
      );
      // and the cycle agency -> complex is refused (the complex is itself managed)
      await expect(setManagedBy(tx, manager, agency.id, complex.id)).rejects.toThrow(
        HIERARCHY_MESSAGES.agencyIsManaged,
      );
      expect((await tx.customer.findUniqueOrThrow({ where: { id: agency.id } })).managedById).toBeNull();
      expect((await tx.customer.findUniqueOrThrow({ where: { id: other.id } })).managedById).toBeNull();
    });
  });

  it("refuses an anonymised or archived agency, and anyone but owner or manager", async () => {
    await withRollback(async (tx) => {
      const gone = await company(tx);
      const archived = await company(tx);
      const complex = await company(tx);
      await anonymiseCustomer(tx, owner, gone.id, formatCustomerNumber(gone.number));
      await archiveCustomer(tx, manager, archived.id);
      await expect(setManagedBy(tx, manager, complex.id, gone.id)).rejects.toThrow(
        HIERARCHY_MESSAGES.agencyAnonymised,
      );
      await expect(setManagedBy(tx, manager, complex.id, archived.id)).rejects.toThrow(
        HIERARCHY_MESSAGES.agencyArchived,
      );
      await expect(setManagedBy(tx, manager, complex.id, randomUUID())).rejects.toThrow(
        HIERARCHY_MESSAGES.agencyMissing,
      );
      await expect(setManagedBy(tx, crew, complex.id, archived.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(clearManagedBy(tx, crew, complex.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setBillsToManager(tx, crew, complex.id, true)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getCustomerHierarchy(tx, crew, complex.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(searchAgencies(tx, crew, { q: "ZZ", excludeId: complex.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });
  });

  it("searches agencies by name, leaving out the customer itself, managed, archived and anonymised ones", async () => {
    await withRollback(async (tx) => {
      const t = tok();
      const agency = await company(tx, `ZZ E2E Agency ${t} North`);
      const self = await company(tx, `ZZ E2E Agency ${t} Self`);
      const managed = await company(tx, `ZZ E2E Agency ${t} Managed`);
      const archived = await company(tx, `ZZ E2E Agency ${t} Archived`);
      const gone = await company(tx, `ZZ E2E Agency ${t} Gone`);
      await setManagedBy(tx, manager, managed.id, agency.id);
      await archiveCustomer(tx, manager, archived.id);
      await anonymiseCustomer(tx, owner, gone.id, formatCustomerNumber(gone.number));
      const found = await searchAgencies(tx, manager, { q: `agency ${t}`, excludeId: self.id });
      expect(found).toEqual([{ id: agency.id, number: agency.number, displayName: agency.name }]);
      expect(await searchAgencies(tx, manager, { q: "Z", excludeId: self.id })).toEqual([]);
    });
  });
});
```

`packages/core/src/portal/anonymise.db.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCustomer } from "../customers/customers";
import { formatCustomerNumber } from "../customers/number";
import { anonymiseCustomer, exportCustomerData } from "../customers/privacy";
import { contactSchema, customerSchema } from "../customers/schemas";
import { manager, owner } from "../quotes/test-helpers";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { HIERARCHY_MESSAGES, setBillsToManager, setManagedBy } from "./hierarchy";

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];
const tok = () => randomUUID().replaceAll("-", "").slice(0, 10);

async function company(tx: Tx) {
  const { id, number } = await createCustomer(tx, manager, {
    customer: customerSchema.parse({ type: "COMPANY", displayName: `ZZ E2E Company ${tok()}`, status: "ACTIVE" }),
    contact: contactSchema.parse({ name: "ZZ E2E Contact", email: `${randomUUID()}@example.com` }),
  });
  return { id, confirm: formatCustomerNumber(number) };
}

/** A contact with portal access and the dates a signed-in person would have. */
async function portalContact(tx: Tx, customerId: string, email: string) {
  const now = new Date();
  return tx.contact.create({
    data: {
      customerId,
      name: `ZZ E2E Person ${tok()}`,
      email,
      portalAccess: true,
      portalInvitedAt: now,
      portalWelcomedAt: now,
      lastSignedInAt: now,
    },
    select: { id: true },
  });
}

/** One live sign-in code and one session for the email. */
async function signInRows(tx: Tx, email: string) {
  const now = new Date();
  await tx.portalCode.create({
    data: { email, codeHash: "0".repeat(64), salt: "0".repeat(32), expiresAt: new Date(now.getTime() + 600_000) },
  });
  await tx.portalSession.create({
    data: {
      tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
      email,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 86_400_000),
      absoluteExpiresAt: new Date(now.getTime() + 2 * 86_400_000),
    },
  });
}

const signIns = async (tx: Tx, email: string) =>
  (await tx.portalCode.count({ where: { email } })) + (await tx.portalSession.count({ where: { email } }));

describe.skipIf(!dbTestsEnabled)("anonymise and the client portal", () => {
  it("refuses an agency that still manages complexes, and changes nothing", async () => {
    await withRollback(async (tx) => {
      const agency = await company(tx);
      const complex = await company(tx);
      await setManagedBy(tx, manager, complex.id, agency.id);
      await expect(anonymiseCustomer(tx, owner, agency.id, agency.confirm)).rejects.toThrow(
        HIERARCHY_MESSAGES.agencyStillManages,
      );
      expect((await tx.customer.findUniqueOrThrow({ where: { id: agency.id } })).anonymisedAt).toBeNull();
    });
  });

  it("clears a complex's link when the complex is anonymised, so its agency can be anonymised next", async () => {
    await withRollback(async (tx) => {
      const agency = await company(tx);
      const complex = await company(tx);
      await setManagedBy(tx, manager, complex.id, agency.id);
      await setBillsToManager(tx, manager, complex.id, false);
      await anonymiseCustomer(tx, owner, complex.id, complex.confirm);
      expect(await tx.customer.findUniqueOrThrow({ where: { id: complex.id } })).toMatchObject({
        managedById: null,
        billsToManager: true,
      });
      await anonymiseCustomer(tx, owner, agency.id, agency.confirm);
      expect((await tx.customer.findUniqueOrThrow({ where: { id: agency.id } })).anonymisedAt).not.toBeNull();
    });
  });

  it("ends the sign-ins of the customer's contacts, but not of an email that still has access elsewhere", async () => {
    await withRollback(async (tx) => {
      const leaving = await company(tx);
      const staying = await company(tx);
      const onlyHere = `${randomUUID()}@example.com`;
      const shared = `${randomUUID()}@example.com`;
      await portalContact(tx, leaving.id, onlyHere);
      await portalContact(tx, leaving.id, shared);
      await portalContact(tx, staying.id, shared);
      await signInRows(tx, onlyHere);
      await signInRows(tx, shared);
      expect(await signIns(tx, onlyHere)).toBe(2);

      await anonymiseCustomer(tx, owner, leaving.id, leaving.confirm);

      expect(await signIns(tx, onlyHere)).toBe(0);
      expect(await signIns(tx, shared)).toBe(2);
      const scrubbed = await tx.contact.findMany({ where: { customerId: leaving.id } });
      for (const c of scrubbed) {
        expect(c).toMatchObject({
          email: null,
          portalAccess: false,
          portalInvitedAt: null,
          portalWelcomedAt: null,
          lastSignedInAt: null,
        });
      }
    });
  });

  it("never puts sign-in codes or sessions in the customer data export", async () => {
    await withRollback(async (tx) => {
      const c = await company(tx);
      const email = `${randomUUID()}@example.com`;
      await portalContact(tx, c.id, email);
      await signInRows(tx, email);
      const text = JSON.stringify(await exportCustomerData(tx, owner, c.id));
      expect(text).toContain(email); // the contact itself is exported
      for (const secret of ["codeHash", "tokenHash", "salt", "portal_codes", "portal_sessions"]) {
        expect(text).not.toContain(secret);
      }
    });
  });
});
```

In `packages/core/src/customers/privacy-order.test.ts`, replace `fakeStore` with this version (it records the new calls and can pretend the customer still manages complexes or has a contact with an email):

```ts
/** A recording stand-in for the database. Only what anonymiseCustomer touches. */
function fakeStore(
  opts: { scrubCount?: number; failOn?: string; managedCount?: number; contacts?: { id: string; email: string }[] } = {},
) {
  const calls: { op: string; where?: Where; data?: Data }[] = [];
  const record = (op: string) => async (args?: { where?: Where; data?: Data }) => {
    calls.push({
      op,
      ...(args?.where ? { where: args.where } : {}),
      ...(args?.data ? { data: args.data } : {}),
    });
    if (opts.failOn === op) throw new Error(`boom in ${op}`);
    if (op === "customer.updateMany") {
      const isScrub = args?.data && "anonymisedAt" in args.data;
      return { count: isScrub ? (opts.scrubCount ?? 1) : 1 };
    }
    return { count: 2 };
  };
  const store = {
    customer: {
      findUnique: async () => ({ id: ID, number: 7, anonymisedAt: null, archivedAt: null }),
      updateMany: record("customer.updateMany"),
      update: record("customer.update"),
      count: async () => opts.managedCount ?? 0,
    },
    contact: {
      updateMany: record("contact.updateMany"),
      findMany: async () => opts.contacts ?? [],
      count: async () => 0,
    },
    property: { updateMany: record("property.updateMany") },
    quote: { updateMany: record("quote.updateMany") },
    portalSession: { deleteMany: record("portalSession.deleteMany") },
    portalCode: { deleteMany: record("portalCode.deleteMany") },
    auditLog: { create: record("auditLog.create") },
  } as unknown as Store;
  return { store, calls };
}
```

and add these two tests inside the `describe`:

```ts
  it("refuses an agency that still manages complexes before writing anything", async () => {
    const { store, calls } = fakeStore({ managedCount: 2 });
    await expect(anonymiseCustomer(store, owner, ID, "C-0007")).rejects.toThrow(
      "This customer still manages complexes.",
    );
    expect(calls.map((c) => c.op)).toEqual([]);
  });

  it("ends the contacts' portal sign-ins before the customer row is marked", async () => {
    const { store, calls } = fakeStore({ contacts: [{ id: "c1", email: "zz.person@example.com" }] });
    await anonymiseCustomer(store, owner, ID, "C-0007");
    const ops = calls.map((c) => c.op);
    const scrubIndex = calls.findIndex((c) => c.data && "anonymisedAt" in c.data);
    expect(ops).toContain("portalSession.deleteMany");
    expect(ops).toContain("portalCode.deleteMany");
    expect(ops.indexOf("portalSession.deleteMany")).toBeLessThan(scrubIndex);
    expect(calls.find((c) => c.op === "portalSession.deleteMany")?.where).toEqual({
      email: "zz.person@example.com",
    });
  });
```

Run `cd packages/core && npx vitest run src/customers/privacy-order.test.ts && cd ../..`: expect FAIL (the two new tests; the refusal message does not exist yet and no sign-ins are ended). The two `.db.test.ts` files fail to compile until `hierarchy.ts` exists (they run in the controller's `test:db`).

- [ ] **Step 2: Write `packages/core/src/portal/end-sign-ins.ts`**

```ts
import type { Db } from "../db";

/**
 * Deletes the portal sessions and sign-in codes of each email, unless another contact (one not listed in
 * `exceptContactIds`) with that email still has portal access. Used when access is removed, a contact is
 * removed or changes email, and when a customer is anonymised. Returns how many emails were signed out.
 * Staff-side only: no role check here, so it is not exported from any barrel.
 */
export async function endPortalSignIns(
  store: Pick<Db, "contact" | "portalCode" | "portalSession">,
  emails: readonly string[],
  exceptContactIds: readonly string[],
): Promise<number> {
  let ended = 0;
  for (const email of new Set(emails)) {
    const stillHasAccess = await store.contact.count({
      where: { email, portalAccess: true, id: { notIn: [...exceptContactIds] } },
    });
    if (stillHasAccess > 0) continue;
    await store.portalSession.deleteMany({ where: { email } });
    await store.portalCode.deleteMany({ where: { email } });
    ended += 1;
  }
  return ended;
}
```

- [ ] **Step 3: Write `packages/core/src/portal/hierarchy.ts`**

```ts
import { assertRole, DomainError, MANAGEMENT, type Actor } from "../customers/access";
import {
  findEditableCustomer,
  lockCustomer,
  logCustomerEvent,
  type Store,
} from "../customers/store";
import type { CustomerStatus } from "../generated/prisma/enums";

/** Every refusal of the managing-agency rules. The staff app maps them to fixed codes in the address bar. */
export const HIERARCHY_MESSAGES = {
  self: "A customer cannot manage itself.",
  agencyMissing: "That agency could not be found.",
  agencyAnonymised: "An anonymised customer cannot be linked.",
  agencyArchived: "Restore that agency before linking complexes to it.",
  agencyIsManaged: "That customer is itself managed by an agency. Only one level is allowed.",
  complexManagesOthers: "This customer manages complexes itself, so it cannot be managed by an agency.",
  notManaged: "Link this customer to a managing agency first.",
  agencyStillManages:
    "This customer still manages complexes. Move its complexes to another agency, or remove their link, before anonymising it.",
} as const;
export type HierarchyMessageKey = keyof typeof HIERARCHY_MESSAGES;

async function readAgency(store: Store, agencyId: string) {
  const agency = await store.customer.findUnique({
    where: { id: agencyId },
    select: { id: true, status: true, anonymisedAt: true, managedById: true },
  });
  if (!agency) throw new DomainError(HIERARCHY_MESSAGES.agencyMissing);
  if (agency.anonymisedAt) throw new DomainError(HIERARCHY_MESSAGES.agencyAnonymised);
  if (agency.status === "ARCHIVED") throw new DomainError(HIERARCHY_MESSAGES.agencyArchived);
  if (agency.managedById) throw new DomainError(HIERARCHY_MESSAGES.agencyIsManaged);
  return agency;
}

async function assertManagesNobody(store: Store, customerId: string) {
  if ((await store.customer.count({ where: { managedById: customerId } })) > 0) {
    throw new DomainError(HIERARCHY_MESSAGES.complexManagesOthers);
  }
}

/**
 * Links a complex to its managing agency (or moves it to another one). One level only: the agency must
 * not itself be managed, and the complex must not manage anyone. Lock order: both customers, smaller id
 * first, then every rule is checked again on fresh reads.
 */
export async function setManagedBy(
  store: Store,
  actor: Actor,
  complexId: string,
  agencyId: string,
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  if (complexId === agencyId) throw new DomainError(HIERARCHY_MESSAGES.self);
  const check = async () => {
    const complex = await findEditableCustomer(store, complexId);
    await readAgency(store, agencyId);
    await assertManagesNobody(store, complexId);
    return complex;
  };
  if ((await check()).managedById === agencyId) return;
  for (const id of [complexId, agencyId].sort()) await lockCustomer(store, id);
  const complex = await check();
  if (complex.managedById === agencyId) return;
  const previous = complex.managedById;
  await store.customer.update({
    where: { id: complexId },
    data: { managedById: agencyId },
    select: { id: true },
  });
  await logCustomerEvent(store, actor, "customer.manager_set", complexId, {
    managerId: agencyId,
    previousManagerId: previous,
  });
  await logCustomerEvent(store, actor, "customer.complex_added", agencyId, { complexId });
  if (previous) {
    await logCustomerEvent(store, actor, "customer.complex_removed", previous, { complexId });
  }
}

/** Removes the complex's managing agency. "Bills go to" returns to its default. */
export async function clearManagedBy(store: Store, actor: Actor, complexId: string): Promise<void> {
  assertRole(actor, MANAGEMENT);
  if (!(await findEditableCustomer(store, complexId)).managedById) return;
  await lockCustomer(store, complexId);
  const complex = await findEditableCustomer(store, complexId);
  const previous = complex.managedById;
  if (!previous) return;
  await store.customer.update({
    where: { id: complexId },
    data: { managedById: null, billsToManager: true },
    select: { id: true },
  });
  await logCustomerEvent(store, actor, "customer.manager_cleared", complexId, {
    previousManagerId: previous,
  });
  await logCustomerEvent(store, actor, "customer.complex_removed", previous, { complexId });
}

/** While a complex is managed: bills go to the agency (true) or to the complex itself (false). */
export async function setBillsToManager(
  store: Store,
  actor: Actor,
  complexId: string,
  billsToManager: boolean,
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  const check = async () => {
    const complex = await findEditableCustomer(store, complexId);
    if (!complex.managedById) throw new DomainError(HIERARCHY_MESSAGES.notManaged);
    return complex;
  };
  if ((await check()).billsToManager === billsToManager) return;
  await lockCustomer(store, complexId);
  if ((await check()).billsToManager === billsToManager) return;
  await store.customer.update({
    where: { id: complexId },
    data: { billsToManager },
    select: { id: true },
  });
  await logCustomerEvent(store, actor, "customer.bills_to_changed", complexId, { billsToManager });
}

export type CustomerHierarchy = {
  manager: { id: string; number: number; displayName: string } | null;
  billsToManager: boolean;
  complexes: {
    id: string;
    number: number;
    displayName: string;
    status: CustomerStatus;
    propertyCount: number;
    quoteCount: number;
  }[];
};

/** The customer's managing agency (if any), its billing switch, and the complexes it manages. */
export async function getCustomerHierarchy(
  store: Store,
  actor: Actor,
  customerId: string,
): Promise<CustomerHierarchy> {
  assertRole(actor, MANAGEMENT);
  const row = await store.customer.findUnique({
    where: { id: customerId },
    select: {
      billsToManager: true,
      managedBy: { select: { id: true, number: true, displayName: true } },
      managedCustomers: {
        orderBy: { displayName: "asc" },
        select: {
          id: true,
          number: true,
          displayName: true,
          status: true,
          _count: { select: { properties: { where: { archivedAt: null } }, quotes: true } },
        },
      },
    },
  });
  if (!row) throw new DomainError("That customer could not be found.");
  return {
    manager: row.managedBy,
    billsToManager: row.billsToManager,
    complexes: row.managedCustomers.map((c) => ({
      id: c.id,
      number: c.number,
      displayName: c.displayName,
      status: c.status,
      propertyCount: c._count.properties,
      quoteCount: c._count.quotes,
    })),
  };
}

export type AgencyOption = { id: string; number: number; displayName: string };

/** Customers that could become this customer's managing agency, by name. At least two characters. */
export async function searchAgencies(
  store: Store,
  actor: Actor,
  query: { q: string; excludeId: string },
): Promise<AgencyOption[]> {
  assertRole(actor, MANAGEMENT);
  const term = query.q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const contains = { contains: term, mode: "insensitive" } as const;
  return store.customer.findMany({
    where: {
      id: { not: query.excludeId },
      managedById: null,
      anonymisedAt: null,
      status: { not: "ARCHIVED" },
      OR: [{ displayName: contains }, { companyName: contains }],
    },
    orderBy: { displayName: "asc" },
    take: 10,
    select: { id: true, number: true, displayName: true },
  });
}
```

- [ ] **Step 4: Widen `Store` and change `anonymiseCustomer`**

In `packages/core/src/customers/store.ts`, change the `Store` type to:

```ts
export type Store = Pick<
  Db,
  "customer" | "contact" | "property" | "auditLog" | "staffUser" | "quote" | "portalCode" | "portalSession"
>;
```

In `packages/core/src/customers/privacy.ts`:

- add imports: `import { endPortalSignIns } from "../portal/end-sign-ins";` and `import { HIERARCHY_MESSAGES } from "../portal/hierarchy";`;
- in `anonymiseCustomer`, replace the single line `await lockCustomer(store, id);` with:

```ts
  // An agency that still manages complexes cannot be anonymised. Checked before the lock (a refused request
  // takes no lock) and again under it (linking a complex locks the agency too).
  const stillManages = async () => (await store.customer.count({ where: { managedById: id } })) > 0;
  if (await stillManages()) throw new DomainError(HIERARCHY_MESSAGES.agencyStillManages);
  await lockCustomer(store, id);
  if (await stillManages()) throw new DomainError(HIERARCHY_MESSAGES.agencyStillManages);

  // Portal sign-ins of this customer's contacts end now (unless that email still has access elsewhere).
  const withEmail = await store.contact.findMany({
    where: { customerId: id, email: { not: null } },
    select: { id: true, email: true },
  });
  await endPortalSignIns(
    store,
    withEmail.flatMap((c) => (c.email ? [c.email] : [])),
    withEmail.map((c) => c.id),
  );
```

- in the `store.contact.updateMany` scrub, change `data` to:

```ts
    data: {
      name: "Anonymised contact",
      role: null,
      email: null,
      phone: null,
      portalAccess: false,
      portalInvitedAt: null,
      portalWelcomedAt: null,
      lastSignedInAt: null,
    },
```

- in the final conditional `store.customer.updateMany` scrub, add `managedById: null,` and `billsToManager: true,` to `data` (after `consentNote: null,`).
- update the doc comment of `anonymiseCustomer`: add the sentence `An agency that still manages complexes is refused; a complex loses its Managed by link; the contacts' portal sign-ins end.`

`packages/core/src/index.ts`: add

```ts
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
```

- [ ] **Step 5: Run the unit tests, check and commit**

```bash
cd packages/core && npx vitest run src/customers/privacy-order.test.ts src/customers/privacy-coverage.test.ts && cd ../..
npx prettier --write packages/core/src/portal/hierarchy.ts packages/core/src/portal/hierarchy.db.test.ts packages/core/src/portal/end-sign-ins.ts packages/core/src/portal/anonymise.db.test.ts packages/core/src/customers/store.ts packages/core/src/customers/privacy.ts packages/core/src/customers/privacy-order.test.ts packages/core/src/index.ts
npm run typecheck
npm run lint
npm run test
git add packages/core/src/portal/hierarchy.ts packages/core/src/portal/hierarchy.db.test.ts packages/core/src/portal/end-sign-ins.ts packages/core/src/portal/anonymise.db.test.ts packages/core/src/customers/store.ts packages/core/src/customers/privacy.ts packages/core/src/customers/privacy-order.test.ts packages/core/src/index.ts
git commit -m "Add the managing-agency rules and make anonymise end portal sign-ins and clear links

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: unit tests, typecheck and lint pass. The new database tests run in the controller's `npm run test:db` after the task (the migration is applied by then).

---
### Task 6: The visible set and sign-in (codes, sessions, sign out), run as `ace_portal`

**Files:**
- Modify: `packages/core/src/portal/scope.ts` (append `loadPortalScope`)
- Create: `packages/core/src/portal/store.ts`
- Create: `packages/core/src/portal/signin.ts`
- Create: `packages/core/src/portal/test-helpers.ts`
- Create: `packages/core/src/portal/signin.db.test.ts`
- Modify: `packages/core/src/portal/index.ts`

**Interfaces:**
- Consumes: `buildScope`, `needsWelcome`, `PortalScope` (Task 3, `scope.ts`); `normaliseEmail`, `hashEmail` (Task 3); `MAX_CODE_ATTEMPTS`, `codeExpiresAt`, `generateSignInCode`, `hashSignInCode`, `isSignInCodeShape`, `newCodeSalt`, `signInCodeMatches` (Task 3); `generateSessionToken`, `hashSessionToken`, `isSessionLive`, `isSessionTokenShape`, `newSessionTimes`, `shouldTouchSession`, `slideSessionExpiry` (Task 3); `checkRateLimit` (`quotes/public.ts`, per-kind since Task 3); `createCustomer`, schemas; `createQuote`, `issueQuote`, `fillDraft`, `manager`, `token` (quotes).
- Produces:
  - `scope.ts`: `loadPortalScope(store: Pick<Db, "contact" | "customer">, email: string): Promise<PortalScope | null>`.
  - `store.ts`: `type PortalStore = Pick<Db, "contact" | "customer" | "property" | "quote" | "quoteLine" | "quoteScopeItem" | "auditLog" | "publicLinkHit" | "portalCode" | "portalSession" | "$queryRaw">`.
  - `signin.ts`:
    - `type SignInCodeMessage = { to: string; code: string }`
    - `type RequestCodeOutcome = "SENT" | "NO_MATCH" | "INVALID_EMAIL" | "LIMITED"`
    - `requestSignInCode(store: PortalStore, input: { email: string; ipHash: string }, deps: { send: (message: SignInCodeMessage) => Promise<void>; now?: Date; cleanup?: boolean }): Promise<{ outcome: RequestCodeOutcome }>`
    - `type VerifyResult = { outcome: "OK"; token: string; expiresAt: Date; needsWelcome: boolean } | { outcome: "WRONG" } | { outcome: "EXPIRED" }`
    - `verifySignInCode(store: PortalStore, input: { email: string; code: string }, now?: Date): Promise<VerifyResult>`
    - `type PortalSession = { sessionId: string; scope: PortalScope }`
    - `getPortalSession(store: PortalStore, token: string | null | undefined, opts?: { now?: Date; cleanup?: boolean }): Promise<PortalSession | null>`
    - `signOut(store: Pick<Db, "portalSession">, token: string | null | undefined): Promise<void>`
    - `cleanupPortalSignIns(store: Pick<Db, "portalCode" | "portalSession">, now?: Date): Promise<void>`
  - `test-helpers.ts` (tests only): `AS_PORTAL`; `asPortal<T>(tx, fn: () => Promise<T>): Promise<T>`; `type MadeClient = { customerId: string; propertyId: string; contactId: string; email: string; name: string }`; `makeClient(tx, opts?: { name?: string; managedById?: string; access?: boolean; welcomed?: boolean; email?: string }): Promise<MadeClient>`; `addPortalContact(tx, customerId: string, opts?: { email?: string; access?: boolean; welcomed?: boolean; receivesQuotes?: boolean; name?: string }): Promise<{ contactId: string; email: string }>`; `issueFor(tx, c: { customerId: string; propertyId: string }, draft?: Partial<DraftInput>): Promise<string>` (about 10 seconds each); `scopeOf(tx, email: string): Promise<PortalScope>`; `makeSession(tx, email: string, now?: Date): Promise<string>` (returns the raw token); `mailbox(): { sent: SignInCodeMessage[]; send: (m: SignInCodeMessage) => Promise<void> }`.

How the outcomes are used by the app (Task 11): `SENT` and `NO_MATCH` produce exactly the same reply and the same next page; `INVALID_EMAIL` asks for a valid address; `LIMITED` says to wait an hour. None reveals whether the email is on file. No audit line is written for sign-in (the contact's `lastSignedInAt` records it).

- [ ] **Step 1: Write the store type, the test helpers and the failing tests**

`packages/core/src/portal/store.ts`:

```ts
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
```

`packages/core/src/portal/test-helpers.ts`:

```ts
import { randomUUID } from "node:crypto";
import { createCustomer } from "../customers/customers";
import { contactSchema, customerSchema, propertySchema } from "../customers/schemas";
import type { Prisma } from "../generated/prisma/client";
import { createQuote } from "../quotes/drafts";
import { issueQuote } from "../quotes/issue";
import type { DraftInput } from "../quotes/schemas";
import { fillDraft, manager, token } from "../quotes/test-helpers";
import { loadPortalScope, type PortalScope } from "./scope";
import { generateSessionToken, hashSessionToken, newSessionTimes } from "./session-token";
import type { SignInCodeMessage } from "./signin";

type Tx = Prisma.TransactionClient;

export const AS_PORTAL = `SET LOCAL ROLE "ace_portal"`;

/** Runs `fn` as the portal's own database role, then switches back. */
export async function asPortal<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  await tx.$executeRawUnsafe(AS_PORTAL);
  try {
    return await fn();
  } finally {
    // After a refused statement the transaction is already aborted; the original error matters more.
    await tx.$executeRawUnsafe("RESET ROLE").catch(() => undefined);
  }
}

export type MadeClient = {
  customerId: string;
  propertyId: string;
  contactId: string;
  email: string;
  name: string;
};

/**
 * A made-up company customer with one property and one contact who receives quotes (portal access on and
 * welcomed by default; with `access: false` the contact was never invited).
 */
export async function makeClient(
  tx: Tx,
  opts: { name?: string; managedById?: string; access?: boolean; welcomed?: boolean; email?: string } = {},
): Promise<MadeClient> {
  const email = opts.email ?? `${randomUUID()}@example.com`;
  const name = opts.name ?? `ZZ E2E Client ${token()}`;
  const access = opts.access ?? true;
  const { id } = await createCustomer(tx, manager, {
    customer: customerSchema.parse({ type: "COMPANY", displayName: name, status: "ACTIVE" }),
    contact: contactSchema.parse({ name: `ZZ E2E Person ${token()}`, email, receivesQuotes: "on" }),
    property: propertySchema.parse({ label: "Main", addressLine1: "1 Portal Street", suburb: "Testville" }),
  });
  const contact = await tx.contact.findFirstOrThrow({ where: { customerId: id }, select: { id: true } });
  const property = await tx.property.findFirstOrThrow({ where: { customerId: id }, select: { id: true } });
  await tx.contact.update({
    where: { id: contact.id },
    data: {
      portalAccess: access,
      portalInvitedAt: access ? new Date() : null,
      portalWelcomedAt: access && (opts.welcomed ?? true) ? new Date() : null,
    },
  });
  if (opts.managedById) {
    await tx.customer.update({ where: { id }, data: { managedById: opts.managedById } });
  }
  return { customerId: id, propertyId: property.id, contactId: contact.id, email, name };
}

/** Another contact on an existing customer. */
export async function addPortalContact(
  tx: Tx,
  customerId: string,
  opts: { email?: string; access?: boolean; welcomed?: boolean; receivesQuotes?: boolean; name?: string } = {},
): Promise<{ contactId: string; email: string }> {
  const email = opts.email ?? `${randomUUID()}@example.com`;
  const access = opts.access ?? true;
  const c = await tx.contact.create({
    data: {
      customerId,
      name: opts.name ?? `ZZ E2E Person ${token()}`,
      email,
      receivesQuotes: opts.receivesQuotes ?? true,
      portalAccess: access,
      portalInvitedAt: access ? new Date() : null,
      portalWelcomedAt: access && (opts.welcomed ?? true) ? new Date() : null,
    },
    select: { id: true },
  });
  return { contactId: c.id, email };
}

/** Issues a quote (one monthly line by default) for a customer's property. Takes about 10 seconds. */
export async function issueFor(
  tx: Tx,
  c: { customerId: string; propertyId: string },
  draft?: Partial<DraftInput>,
): Promise<string> {
  const { id } = await createQuote(tx, manager, { customerId: c.customerId, propertyId: c.propertyId });
  await fillDraft(tx, id, draft);
  await issueQuote(tx, manager, id);
  return id;
}

export async function scopeOf(tx: Tx, email: string): Promise<PortalScope> {
  const scope = await loadPortalScope(tx, email);
  if (!scope) throw new Error("Expected the email to have a portal scope.");
  return scope;
}

/** A live session row for the email; returns the raw cookie value. */
export async function makeSession(tx: Tx, email: string, now: Date = new Date()): Promise<string> {
  const raw = generateSessionToken();
  await tx.portalSession.create({
    data: { tokenHash: hashSessionToken(raw), email, createdAt: now, ...newSessionTimes(now) },
  });
  return raw;
}

/** Collects the sign-in emails instead of sending them. */
export function mailbox() {
  const sent: SignInCodeMessage[] = [];
  return {
    sent,
    send: async (message: SignInCodeMessage) => {
      sent.push(message);
    },
  };
}
```

`packages/core/src/portal/signin.db.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashIp } from "../quotes/bots";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { hashSignInCode } from "./codes";
import { hashSessionToken } from "./session-token";
import {
  cleanupPortalSignIns,
  getPortalSession,
  requestSignInCode,
  signOut,
  verifySignInCode,
} from "./signin";
import { asPortal, mailbox, makeClient, makeSession } from "./test-helpers";

const MIN = 60_000;
const DAY = 86_400_000;
const visitor = () => hashIp(randomUUID());

describe.skipIf(!dbTestsEnabled)("portal sign-in, run as ace_portal", () => {
  it("makes no code and sends nothing for an unknown email, a contact without access, or an archived customer", async () => {
    await withRollback(async (tx) => {
      const box = mailbox();
      const unknown = `${randomUUID()}@example.com`;
      const noAccess = await makeClient(tx, { access: false });
      const archived = await makeClient(tx);
      await tx.customer.update({
        where: { id: archived.customerId },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });
      for (const email of [unknown, noAccess.email, archived.email]) {
        const result = await asPortal(tx, () =>
          requestSignInCode(tx, { email, ipHash: visitor() }, { send: box.send, cleanup: false }),
        );
        expect(result, email).toEqual({ outcome: "NO_MATCH" });
        expect(await tx.portalCode.count({ where: { email } })).toBe(0);
      }
      expect(box.sent).toEqual([]);
      expect(
        await asPortal(tx, () =>
          requestSignInCode(tx, { email: "not an email", ipHash: visitor() }, { send: box.send, cleanup: false }),
        ),
      ).toEqual({ outcome: "INVALID_EMAIL" });
    });
  });

  it("sends a code to a known email typed in any case, stores only its salted hash, and replaces an earlier unused code", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const box = mailbox();
      const typed = `  ${client.email.toUpperCase()} `;
      expect(
        await asPortal(tx, () =>
          requestSignInCode(tx, { email: typed, ipHash: visitor() }, { send: box.send, cleanup: false }),
        ),
      ).toEqual({ outcome: "SENT" });
      expect(box.sent).toHaveLength(1);
      expect(box.sent[0]?.to).toBe(client.email);
      const first = box.sent[0]!.code;
      expect(first).toMatch(/^\d{6}$/);
      const rows = await tx.portalCode.findMany({ where: { email: client.email } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.codeHash).toBe(hashSignInCode(first, rows[0]!.salt));
      expect(Object.values(rows[0]!)).not.toContain(first);

      await asPortal(tx, () =>
        requestSignInCode(tx, { email: client.email, ipHash: visitor() }, { send: box.send, cleanup: false }),
      );
      expect(await tx.portalCode.count({ where: { email: client.email, usedAt: null } })).toBe(1);
      const second = box.sent[1]!.code;
      // Two random codes are equal about once in a million runs; only then is this check skipped.
      if (second !== first) {
        expect(await asPortal(tx, () => verifySignInCode(tx, { email: client.email, code: first }))).toEqual({
          outcome: "WRONG",
        });
      }
    });
  });

  it("signs in with the right code: a fresh session stored only as a hash, the code single use, sign out ends it", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx, { welcomed: false });
      const box = mailbox();
      await asPortal(tx, () =>
        requestSignInCode(tx, { email: client.email, ipHash: visitor() }, { send: box.send, cleanup: false }),
      );
      const code = box.sent[0]!.code;
      const ok = await asPortal(tx, () => verifySignInCode(tx, { email: client.email, code: ` ${code} ` }));
      expect(ok.outcome).toBe("OK");
      if (ok.outcome !== "OK") return;
      expect(ok.needsWelcome).toBe(true);
      expect(ok.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const sessions = await tx.portalSession.findMany({ where: { email: client.email } });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.tokenHash).toBe(hashSessionToken(ok.token));
      expect(Object.values(sessions[0]!)).not.toContain(ok.token);
      expect(sessions[0]!.absoluteExpiresAt.getTime() - sessions[0]!.createdAt.getTime()).toBe(90 * DAY);
      expect(sessions[0]!.expiresAt.getTime() - sessions[0]!.createdAt.getTime()).toBe(30 * DAY);
      expect(ok.expiresAt).toEqual(sessions[0]!.absoluteExpiresAt);
      expect(
        (await tx.contact.findUniqueOrThrow({ where: { id: client.contactId } })).lastSignedInAt,
      ).toBeInstanceOf(Date);

      const session = await asPortal(tx, () => getPortalSession(tx, ok.token, { cleanup: false }));
      expect(session?.scope.email).toBe(client.email);
      expect(session?.scope.customerIds).toEqual([client.customerId]);

      expect(await asPortal(tx, () => verifySignInCode(tx, { email: client.email, code }))).toEqual({
        outcome: "EXPIRED",
      });

      await asPortal(tx, () => signOut(tx, ok.token));
      expect(await tx.portalSession.count({ where: { email: client.email } })).toBe(0);
      expect(await asPortal(tx, () => getPortalSession(tx, ok.token, { cleanup: false }))).toBeNull();

      const audit = await tx.auditLog.findMany({ where: { entityId: client.customerId } });
      expect(JSON.stringify(audit)).not.toContain(client.email);
    });
  });

  it("kills a code after five wrong tries, refuses a code after ten minutes, and treats a malformed code as wrong", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const box = mailbox();
      await asPortal(tx, () =>
        requestSignInCode(tx, { email: client.email, ipHash: visitor() }, { send: box.send, cleanup: false }),
      );
      const code = box.sent[0]!.code;
      const wrong = code === "000000" ? "111111" : "000000";
      for (let i = 1; i <= 4; i++) {
        expect(await asPortal(tx, () => verifySignInCode(tx, { email: client.email, code: wrong }))).toEqual({
          outcome: "WRONG",
        });
      }
      // the fifth wrong try kills the code, and then even the right code fails
      expect(await asPortal(tx, () => verifySignInCode(tx, { email: client.email, code: wrong }))).toEqual({
        outcome: "EXPIRED",
      });
      expect(await asPortal(tx, () => verifySignInCode(tx, { email: client.email, code }))).toEqual({
        outcome: "EXPIRED",
      });
      expect((await tx.portalCode.findFirstOrThrow({ where: { email: client.email } })).attempts).toBe(5);
      expect(await tx.portalSession.count({ where: { email: client.email } })).toBe(0);

      const t0 = new Date();
      const box2 = mailbox();
      await asPortal(tx, () =>
        requestSignInCode(
          tx,
          { email: client.email, ipHash: visitor() },
          { send: box2.send, now: t0, cleanup: false },
        ),
      );
      expect(
        await asPortal(tx, () =>
          verifySignInCode(tx, { email: client.email, code: box2.sent[0]!.code }, new Date(t0.getTime() + 10 * MIN)),
        ),
      ).toEqual({ outcome: "EXPIRED" });
      expect(await asPortal(tx, () => verifySignInCode(tx, { email: client.email, code: "12ab56" }))).toEqual({
        outcome: "WRONG",
      });
    });
  });

  it("limits code requests to 3 per email and 10 per visitor per hour, keeping only hashes", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const box = mailbox();
      const now = new Date();
      for (let i = 0; i < 3; i++) {
        const r = await asPortal(tx, () =>
          requestSignInCode(tx, { email: client.email, ipHash: visitor() }, { send: box.send, now, cleanup: false }),
        );
        expect(r.outcome).toBe("SENT");
      }
      expect(
        await asPortal(tx, () =>
          requestSignInCode(tx, { email: client.email, ipHash: visitor() }, { send: box.send, now, cleanup: false }),
        ),
      ).toEqual({ outcome: "LIMITED" });
      expect(box.sent).toHaveLength(3);

      const ip = visitor();
      for (let i = 0; i < 10; i++) {
        const r = await asPortal(tx, () =>
          requestSignInCode(
            tx,
            { email: `${randomUUID()}@example.com`, ipHash: ip },
            { send: box.send, now, cleanup: false },
          ),
        );
        expect(r.outcome).toBe("NO_MATCH");
      }
      expect(
        await asPortal(tx, () =>
          requestSignInCode(
            tx,
            { email: `${randomUUID()}@example.com`, ipHash: ip },
            { send: box.send, now, cleanup: false },
          ),
        ),
      ).toEqual({ outcome: "LIMITED" });
      const buckets = await tx.publicLinkHit.findMany({
        where: { bucket: { startsWith: "code-" } },
        select: { bucket: true },
      });
      expect(buckets.length).toBeGreaterThan(0);
      expect(JSON.stringify(buckets)).not.toContain(client.email);
    });
  });

  it("ends a session at once when access is removed, or the customer is archived or anonymised", async () => {
    await withRollback(async (tx) => {
      const removed = await makeClient(tx);
      const archived = await makeClient(tx);
      const anonymised = await makeClient(tx);
      const tokens = {
        removed: await makeSession(tx, removed.email),
        archived: await makeSession(tx, archived.email),
        anonymised: await makeSession(tx, anonymised.email),
      };
      for (const raw of Object.values(tokens)) {
        expect(await asPortal(tx, () => getPortalSession(tx, raw, { cleanup: false }))).not.toBeNull();
      }
      await tx.contact.update({ where: { id: removed.contactId }, data: { portalAccess: false } });
      await tx.customer.update({
        where: { id: archived.customerId },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });
      await tx.customer.update({ where: { id: anonymised.customerId }, data: { anonymisedAt: new Date() } });
      for (const [label, raw] of Object.entries(tokens)) {
        expect(await asPortal(tx, () => getPortalSession(tx, raw, { cleanup: false })), label).toBeNull();
      }
    });
  });

  it("slides for 30 days from the last use, ends at 90 days, and ignores unknown tokens", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const t0 = new Date();
      const raw = await makeSession(tx, client.email, t0);
      const at20 = new Date(t0.getTime() + 20 * DAY);
      expect(await asPortal(tx, () => getPortalSession(tx, raw, { now: at20, cleanup: false }))).not.toBeNull();
      const row = await tx.portalSession.findFirstOrThrow({ where: { email: client.email } });
      expect(row.lastSeenAt).toEqual(at20);
      expect(row.expiresAt.getTime()).toBe(at20.getTime() + 30 * DAY);
      // unused for 31 days after that use: gone, and the row is deleted
      expect(
        await asPortal(tx, () =>
          getPortalSession(tx, raw, { now: new Date(at20.getTime() + 31 * DAY), cleanup: false }),
        ),
      ).toBeNull();
      expect(await tx.portalSession.count({ where: { email: client.email } })).toBe(0);

      const t1 = new Date();
      const busy = await makeSession(tx, client.email, t1);
      for (const day of [25, 50, 75]) {
        expect(
          await asPortal(tx, () =>
            getPortalSession(tx, busy, { now: new Date(t1.getTime() + day * DAY), cleanup: false }),
          ),
          `day ${day}`,
        ).not.toBeNull();
      }
      expect(
        await asPortal(tx, () => getPortalSession(tx, busy, { now: new Date(t1.getTime() + 90 * DAY), cleanup: false })),
      ).toBeNull();

      expect(await asPortal(tx, () => getPortalSession(tx, "x", { cleanup: false }))).toBeNull();
      expect(await asPortal(tx, () => getPortalSession(tx, "A".repeat(43), { cleanup: false }))).toBeNull();
      expect(await asPortal(tx, () => getPortalSession(tx, undefined, { cleanup: false }))).toBeNull();
    });
  });

  it("cleans up codes and sessions that ended more than a day ago, and keeps the rest", async () => {
    await withRollback(async (tx) => {
      const email = `${randomUUID()}@example.com`;
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 2 * DAY);
      await tx.portalCode.create({
        data: { email, codeHash: "0".repeat(64), salt: "0".repeat(32), expiresAt: twoDaysAgo, createdAt: twoDaysAgo },
      });
      await tx.portalCode.create({
        data: { email, codeHash: "1".repeat(64), salt: "1".repeat(32), expiresAt: new Date(now.getTime() + 10 * MIN) },
      });
      await tx.portalSession.create({
        data: {
          tokenHash: "a".repeat(64),
          email,
          createdAt: new Date(now.getTime() - 40 * DAY),
          lastSeenAt: new Date(now.getTime() - 35 * DAY),
          expiresAt: twoDaysAgo,
          absoluteExpiresAt: new Date(now.getTime() + 50 * DAY),
        },
      });
      await makeSession(tx, email, now);
      await asPortal(tx, () => cleanupPortalSignIns(tx, now));
      expect(await tx.portalCode.count({ where: { email } })).toBe(1);
      expect(await tx.portalSession.count({ where: { email } })).toBe(1);
    });
  });
});
```

Run `npm run typecheck`: expect errors (`./signin` and `loadPortalScope` do not exist yet). The database test itself runs in the controller's `test:db`.

- [ ] **Step 2: Append `loadPortalScope` to `packages/core/src/portal/scope.ts`**

Add at the top of the file: `import type { Db } from "../db";`. Append:

```ts
/**
 * The visible set for a signed-in email, from live data: contacts with that email and portal access whose
 * customer is neither archived nor anonymised, plus the customers those customers manage (also neither
 * archived nor anonymised). Reads only columns the `ace_portal` role is granted.
 */
export async function loadPortalScope(
  store: Pick<Db, "contact" | "customer">,
  email: string,
): Promise<PortalScope | null> {
  const contacts = await store.contact.findMany({
    where: {
      email,
      portalAccess: true,
      customer: { status: { not: "ARCHIVED" }, anonymisedAt: null },
    },
    orderBy: { id: "asc" },
    select: { id: true, customerId: true, name: true, portalWelcomedAt: true },
  });
  if (contacts.length === 0) return null;
  const own = [...new Set(contacts.map((c) => c.customerId))];
  const managed = await store.customer.findMany({
    where: { managedById: { in: own }, status: { not: "ARCHIVED" }, anonymisedAt: null },
    orderBy: { id: "asc" },
    select: { id: true, managedById: true },
  });
  return buildScope(
    email,
    contacts.map((c) => ({
      id: c.id,
      customerId: c.customerId,
      name: c.name,
      welcomed: c.portalWelcomedAt !== null,
    })),
    managed.flatMap((m) => (m.managedById ? [{ id: m.id, managedById: m.managedById }] : [])),
  );
}
```

- [ ] **Step 3: Write `packages/core/src/portal/signin.ts`**

```ts
import type { Db } from "../db";
import { checkRateLimit } from "../quotes/public";
import {
  MAX_CODE_ATTEMPTS,
  codeExpiresAt,
  generateSignInCode,
  hashSignInCode,
  isSignInCodeShape,
  newCodeSalt,
  signInCodeMatches,
} from "./codes";
import { hashEmail, normaliseEmail } from "./email-address";
import { loadPortalScope, needsWelcome, type PortalScope } from "./scope";
import {
  generateSessionToken,
  hashSessionToken,
  isSessionLive,
  isSessionTokenShape,
  newSessionTimes,
  shouldTouchSession,
  slideSessionExpiry,
} from "./session-token";
import type { PortalStore } from "./store";

const DAY_MS = 86_400_000;

export type SignInCodeMessage = { to: string; code: string };
export type RequestCodeOutcome = "SENT" | "NO_MATCH" | "INVALID_EMAIL" | "LIMITED";

/**
 * Deletes codes and sessions that ended more than a day ago. Called on about one request in a hundred
 * (`cleanup` forces or prevents it, for tests).
 */
export async function cleanupPortalSignIns(
  store: Pick<Db, "portalCode" | "portalSession">,
  now: Date = new Date(),
): Promise<void> {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  await store.portalCode.deleteMany({
    where: { OR: [{ createdAt: { lt: dayAgo } }, { expiresAt: { lt: dayAgo } }] },
  });
  await store.portalSession.deleteMany({
    where: { OR: [{ expiresAt: { lt: dayAgo } }, { absoluteExpiresAt: { lt: dayAgo } }] },
  });
}

/**
 * Step 1 of signing in. Counts the request against the email (hashed) and the visitor (hashed) limits,
 * then, only if the email belongs to a contact in scope, replaces that email's unused codes with a new one
 * and hands it to `send`. The caller shows the same reply for SENT and NO_MATCH.
 */
export async function requestSignInCode(
  store: PortalStore,
  input: { email: string; ipHash: string },
  deps: { send: (message: SignInCodeMessage) => Promise<void>; now?: Date; cleanup?: boolean },
): Promise<{ outcome: RequestCodeOutcome }> {
  const email = normaliseEmail(input.email);
  if (!email) return { outcome: "INVALID_EMAIL" };
  const now = deps.now ?? new Date();
  const byEmail = await checkRateLimit(store, "code-email", hashEmail(email), { now, cleanup: false });
  const byVisitor = await checkRateLimit(store, "code-ip", input.ipHash, {
    now,
    cleanup: deps.cleanup,
  });
  if (!byEmail.allowed || !byVisitor.allowed) return { outcome: "LIMITED" };
  if (deps.cleanup ?? Math.random() < 0.01) await cleanupPortalSignIns(store, now);

  if (!(await loadPortalScope(store, email))) return { outcome: "NO_MATCH" };
  const code = generateSignInCode();
  const salt = newCodeSalt();
  await store.portalCode.deleteMany({ where: { email, usedAt: null } });
  await store.portalCode.create({
    data: { email, codeHash: hashSignInCode(code, salt), salt, expiresAt: codeExpiresAt(now), createdAt: now },
    select: { id: true },
  });
  await deps.send({ to: email, code });
  return { outcome: "SENT" };
}

export type VerifyResult =
  | { outcome: "OK"; token: string; expiresAt: Date; needsWelcome: boolean }
  | { outcome: "WRONG" }
  | { outcome: "EXPIRED" };

/**
 * Step 2 of signing in. Checks the email's latest unused code (constant-time), counts a wrong try (the
 * fifth kills the code), claims the code with one conditional statement (single use), and makes a new
 * session with a fresh random token. Returns the raw token for the cookie; only its hash is stored.
 */
export async function verifySignInCode(
  store: PortalStore,
  input: { email: string; code: string },
  now: Date = new Date(),
): Promise<VerifyResult> {
  const email = normaliseEmail(input.email);
  const code = input.code.replace(/\s/g, "");
  if (!email || !isSignInCodeShape(code)) return { outcome: "WRONG" };
  const row = await store.portalCode.findFirst({
    where: { email, usedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, codeHash: true, salt: true, expiresAt: true, attempts: true },
  });
  if (!row || row.expiresAt.getTime() <= now.getTime() || row.attempts >= MAX_CODE_ATTEMPTS) {
    return { outcome: "EXPIRED" };
  }
  if (!signInCodeMatches(code, row.salt, row.codeHash)) {
    await store.portalCode.updateMany({
      where: { id: row.id, usedAt: null },
      data: { attempts: { increment: 1 } },
    });
    return { outcome: row.attempts + 1 >= MAX_CODE_ATTEMPTS ? "EXPIRED" : "WRONG" };
  }
  const claimed = await store.portalCode.updateMany({
    where: { id: row.id, usedAt: null, attempts: { lt: MAX_CODE_ATTEMPTS }, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) return { outcome: "EXPIRED" };
  // Access may have been removed since the code was sent.
  const scope = await loadPortalScope(store, email);
  if (!scope) return { outcome: "EXPIRED" };

  const token = generateSessionToken();
  const times = newSessionTimes(now);
  await store.portalSession.create({
    data: { tokenHash: hashSessionToken(token), email, createdAt: now, ...times },
    select: { id: true },
  });
  await store.contact.updateMany({
    where: { id: { in: scope.contacts.map((c) => c.id) } },
    data: { lastSignedInAt: now },
  });
  return { outcome: "OK", token, expiresAt: times.absoluteExpiresAt, needsWelcome: needsWelcome(scope) };
}

export type PortalSession = { sessionId: string; scope: PortalScope };

/**
 * The signed-in person for a cookie value, or null. Valid only while the session has not ended AND the
 * email still has at least one contact in scope (so removing access, archiving or anonymising ends it at
 * once). Touches the session (last seen, sliding end) at most once an hour.
 */
export async function getPortalSession(
  store: PortalStore,
  token: string | null | undefined,
  opts: { now?: Date; cleanup?: boolean } = {},
): Promise<PortalSession | null> {
  if (!token || !isSessionTokenShape(token)) return null;
  const now = opts.now ?? new Date();
  if (opts.cleanup ?? Math.random() < 0.01) await cleanupPortalSignIns(store, now);
  const session = await store.portalSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: { id: true, email: true, lastSeenAt: true, expiresAt: true, absoluteExpiresAt: true },
  });
  if (!session) return null;
  if (!isSessionLive(session, now)) {
    await store.portalSession.deleteMany({ where: { id: session.id } });
    return null;
  }
  const scope = await loadPortalScope(store, session.email);
  if (!scope) return null;
  if (shouldTouchSession(session.lastSeenAt, now)) {
    await store.portalSession.updateMany({
      where: { id: session.id },
      data: { lastSeenAt: now, expiresAt: slideSessionExpiry(now, session.absoluteExpiresAt) },
    });
  }
  return { sessionId: session.id, scope };
}

/** Deletes the session behind this cookie value. */
export async function signOut(
  store: Pick<Db, "portalSession">,
  token: string | null | undefined,
): Promise<void> {
  if (!token || !isSessionTokenShape(token)) return;
  await store.portalSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}
```

Append to `packages/core/src/portal/index.ts`:

```ts
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
```

- [ ] **Step 4: Check and commit**

```bash
npx prettier --write packages/core/src/portal/scope.ts packages/core/src/portal/store.ts packages/core/src/portal/signin.ts packages/core/src/portal/test-helpers.ts packages/core/src/portal/signin.db.test.ts packages/core/src/portal/index.ts
npm run typecheck
npm run lint
npm run test
git add packages/core/src/portal/scope.ts packages/core/src/portal/store.ts packages/core/src/portal/signin.ts packages/core/src/portal/test-helpers.ts packages/core/src/portal/signin.db.test.ts packages/core/src/portal/index.ts
git commit -m "Add the portal visible set and sign-in: codes, sessions, sign out and cleanup

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: typecheck, lint and unit tests pass. The controller runs `npm run test:db` after this task; every new test must pass there.

---

### Task 7: The welcome page logic

**Files:**
- Create: `packages/core/src/portal/welcome-schema.ts`, `welcome-schema.test.ts`
- Create: `packages/core/src/portal/welcome.ts`, `welcome.db.test.ts`
- Modify: `packages/core/src/portal/index.ts`

**Interfaces:**
- Consumes: `PortalScope`, `loadPortalScope` (Task 6); `clientParty` (`audit.ts`); `DomainError` (`customers/access.ts`); `changedFields`, `findEditableCustomerNarrow`, `lockCustomer`, `logCustomerEventAs` (`customers/store.ts`); `normalisePhone` (`customers/phone.ts`); `asPortal`, `makeClient`, `addPortalContact`, `scopeOf` (Task 6 test helpers).
- Produces:
  - `welcome-schema.ts`: `welcomeSchema` (zod) with fields `contactId` (uuid), `name` (1 to 120), `phone` (blank becomes `null`, otherwise normalised to `+27...` or the message `Enter a South African number, e.g. 082 123 4567.`), `billingLine1`, `billingLine2` (150), `billingSuburb`, `billingCity` (80), `billingPostalCode` (10) (blank becomes `null`), `consent` (must be `"on"`, message `Tick the box to agree before you continue.`); `type WelcomeInput = z.output<typeof welcomeSchema>`.
  - `welcome.ts`: `WELCOME_GONE = "This step is no longer needed. Refresh the page."`; `type WelcomeStep = { contactId: string; name: string; phone: string | null; email: string; customerName: string; isCompany: boolean; billing: { billingLine1: string | null; billingLine2: string | null; billingSuburb: string | null; billingCity: string | null; billingPostalCode: string | null }; consentRecorded: boolean; remaining: number }`; `getWelcomeStep(store: Pick<Db, "contact">, scope: PortalScope): Promise<WelcomeStep | null>`; `completeWelcome(store: Pick<Db, "contact" | "customer" | "auditLog">, scope: PortalScope, input: WelcomeInput, now?: Date): Promise<void>`.
- Audit: `customer.portal_welcomed` on the contact's own customer, actor `CUSTOMER` (`clientParty(customerId)`), `after: { contactId, changed: string[] (field names), consentRecorded: boolean }`.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/portal/welcome-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { welcomeSchema } from "./welcome-schema";

const base = {
  contactId: "11111111-1111-4111-8111-111111111111",
  name: " ZZ Person ",
  phone: "082 123 4567",
  billingLine1: "1 ZZ Road",
  billingLine2: "",
  billingSuburb: "ZZ Suburb",
  billingCity: "",
  billingPostalCode: "7441",
  consent: "on",
};

describe("welcomeSchema", () => {
  it("trims, normalises the phone and turns blanks into null", () => {
    expect(welcomeSchema.parse(base)).toEqual({
      contactId: base.contactId,
      name: "ZZ Person",
      phone: "+27821234567",
      billingLine1: "1 ZZ Road",
      billingLine2: null,
      billingSuburb: "ZZ Suburb",
      billingCity: null,
      billingPostalCode: "7441",
      consent: "on",
    });
    expect(welcomeSchema.parse({ ...base, phone: "  " }).phone).toBeNull();
  });
  it("needs the consent tick, a name and a South African phone", () => {
    const noConsent = welcomeSchema.safeParse({ ...base, consent: "" });
    expect(noConsent.success).toBe(false);
    expect(noConsent.error?.issues[0]?.message).toBe("Tick the box to agree before you continue.");
    const noName = welcomeSchema.safeParse({ ...base, name: "  " });
    expect(noName.error?.issues[0]?.message).toBe("Enter your name.");
    const badPhone = welcomeSchema.safeParse({ ...base, phone: "12" });
    expect(badPhone.error?.issues[0]?.message).toBe("Enter a South African number, e.g. 082 123 4567.");
    expect(welcomeSchema.safeParse({ ...base, contactId: "nope" }).success).toBe(false);
  });
});
```

`packages/core/src/portal/welcome.db.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { asPortal, addPortalContact, makeClient, scopeOf } from "./test-helpers";
import { WELCOME_GONE, completeWelcome, getWelcomeStep } from "./welcome";
import type { WelcomeInput } from "./welcome-schema";

const input = (contactId: string, over: Partial<WelcomeInput> = {}): WelcomeInput => ({
  contactId,
  name: "ZZ E2E Welcomed Person",
  phone: "+27821112233",
  billingLine1: "ZZ 9 Billing Road",
  billingLine2: null,
  billingSuburb: "ZZ Billing Suburb",
  billingCity: "ZZ Billing City",
  billingPostalCode: "7441",
  consent: "on",
  ...over,
});

describe.skipIf(!dbTestsEnabled)("the portal welcome, run as ace_portal", () => {
  it("shows one contact at a time and records the welcome on that contact and its own customer only", async () => {
    await withRollback(async (tx) => {
      const email = `${randomUUID()}@example.com`;
      const agency = await makeClient(tx, { email, welcomed: false });
      const complex = await makeClient(tx, { managedById: agency.customerId });
      await addPortalContact(tx, complex.customerId, { email, welcomed: false });
      const complexBefore = await tx.customer.findUniqueOrThrow({ where: { id: complex.customerId } });

      const step = await asPortal(tx, async () => getWelcomeStep(tx, await scopeOf(tx, email)));
      expect(step?.remaining).toBe(2);
      expect(step?.email).toBe(email);
      const stepCustomer = step?.contactId === agency.contactId ? agency.customerId : complex.customerId;
      const otherCustomer = stepCustomer === agency.customerId ? complex.customerId : agency.customerId;

      await asPortal(tx, async () => completeWelcome(tx, await scopeOf(tx, email), input(step!.contactId)));

      const contact = await tx.contact.findUniqueOrThrow({ where: { id: step!.contactId } });
      expect(contact).toMatchObject({ name: "ZZ E2E Welcomed Person", phone: "+27821112233" });
      expect(contact.portalWelcomedAt).toBeInstanceOf(Date);
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: stepCustomer } });
      expect(customer).toMatchObject({
        billingLine1: "ZZ 9 Billing Road",
        billingSuburb: "ZZ Billing Suburb",
        billingCity: "ZZ Billing City",
        billingPostalCode: "7441",
        consentSource: "portal",
      });
      expect(customer.consentAt).toBeInstanceOf(Date);
      const other = await tx.customer.findUniqueOrThrow({ where: { id: otherCustomer } });
      // Both made-up customers start with no billing address and no consent; the other one is untouched.
      expect(complexBefore.billingLine1).toBeNull();
      expect(other.billingLine1).toBeNull();
      expect(other.consentSource).toBeNull();

      const audit = await tx.auditLog.findMany({
        where: { entityId: stepCustomer, action: "customer.portal_welcomed" },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actorType: "CUSTOMER", actorId: stepCustomer, ip: null, userAgent: null });
      const after = audit[0]?.after as { contactId: string; changed: string[]; consentRecorded: boolean };
      expect(after.contactId).toBe(step!.contactId);
      expect(after.changed).toEqual(expect.arrayContaining(["name", "phone", "billingLine1"]));
      expect(after.consentRecorded).toBe(true);
      const text = JSON.stringify(audit);
      for (const typed of ["ZZ E2E Welcomed Person", "+27821112233", "ZZ 9 Billing Road", email]) {
        expect(text).not.toContain(typed);
      }

      const next = await asPortal(tx, async () => getWelcomeStep(tx, await scopeOf(tx, email)));
      expect(next?.remaining).toBe(1);
      expect(next?.contactId).not.toBe(step!.contactId);
      await asPortal(tx, async () => completeWelcome(tx, await scopeOf(tx, email), input(next!.contactId)));
      expect(await asPortal(tx, async () => getWelcomeStep(tx, await scopeOf(tx, email)))).toBeNull();
    });
  });

  it("keeps an earlier consent, and refuses another person's contact or a step already done", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx, { welcomed: false });
      const stranger = await makeClient(tx, { welcomed: false });
      const earlier = new Date("2026-01-15T08:00:00.000Z");
      await tx.customer.update({
        where: { id: client.customerId },
        data: { consentAt: earlier, consentSource: "staff" },
      });
      const scope = await scopeOf(tx, client.email);

      await expect(
        asPortal(tx, () => completeWelcome(tx, scope, input(stranger.contactId))),
      ).rejects.toThrow(WELCOME_GONE);
      expect((await tx.contact.findUniqueOrThrow({ where: { id: stranger.contactId } })).portalWelcomedAt).toBeNull();

      await asPortal(tx, () => completeWelcome(tx, scope, input(client.contactId)));
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: client.customerId } });
      expect(customer.consentAt).toEqual(earlier);
      expect(customer.consentSource).toBe("staff");

      // The old scope still lists the contact as not welcomed; the check under the lock refuses anyway.
      await expect(asPortal(tx, () => completeWelcome(tx, scope, input(client.contactId)))).rejects.toThrow(
        WELCOME_GONE,
      );
    });
  });
});
```

Run `cd packages/core && npx vitest run src/portal/welcome-schema.test.ts && cd ../..`: expect FAIL (module missing).

- [ ] **Step 2: Write `packages/core/src/portal/welcome-schema.ts`**

```ts
import { z } from "zod";
import { normalisePhone } from "../customers/phone";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((v) => (v === "" ? null : v));

/** The welcome form. Everything arrives as text; a blank optional field becomes null. */
export const welcomeSchema = z.object({
  contactId: z.uuid(),
  name: z.string().trim().min(1, "Enter your name.").max(120, "Keep this under 120 characters."),
  phone: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const normalised = normalisePhone(v);
      if (!normalised) {
        ctx.addIssue({ code: "custom", message: "Enter a South African number, e.g. 082 123 4567." });
        return z.NEVER;
      }
      return normalised;
    }),
  billingLine1: optionalText(150),
  billingLine2: optionalText(150),
  billingSuburb: optionalText(80),
  billingCity: optionalText(80),
  billingPostalCode: optionalText(10),
  consent: z.literal("on", { error: "Tick the box to agree before you continue." }),
});
export type WelcomeInput = z.output<typeof welcomeSchema>;
```

- [ ] **Step 3: Write `packages/core/src/portal/welcome.ts`**

```ts
import { clientParty } from "../audit";
import { DomainError } from "../customers/access";
import {
  changedFields,
  findEditableCustomerNarrow,
  lockCustomer,
  logCustomerEventAs,
} from "../customers/store";
import type { Db } from "../db";
import type { PortalScope } from "./scope";
import type { WelcomeInput } from "./welcome-schema";

export const WELCOME_GONE = "This step is no longer needed. Refresh the page.";

export type WelcomeStep = {
  contactId: string;
  name: string;
  phone: string | null;
  email: string;
  customerName: string;
  isCompany: boolean;
  billing: {
    billingLine1: string | null;
    billingLine2: string | null;
    billingSuburb: string | null;
    billingCity: string | null;
    billingPostalCode: string | null;
  };
  consentRecorded: boolean;
  /** Contacts still to welcome, this one included. */
  remaining: number;
};

/** The next contact of this person still to welcome (one at a time), or null when all are done. */
export async function getWelcomeStep(
  store: Pick<Db, "contact">,
  scope: PortalScope,
): Promise<WelcomeStep | null> {
  const pending = scope.contacts.filter((c) => !c.welcomed).map((c) => c.id);
  if (pending.length === 0) return null;
  const contact = await store.contact.findFirst({
    where: { id: { in: pending }, email: scope.email, portalAccess: true, portalWelcomedAt: null },
    orderBy: { id: "asc" },
    select: {
      id: true,
      name: true,
      phone: true,
      customer: {
        select: {
          displayName: true,
          type: true,
          billingLine1: true,
          billingLine2: true,
          billingSuburb: true,
          billingCity: true,
          billingPostalCode: true,
          consentAt: true,
        },
      },
    },
  });
  if (!contact) return null;
  const c = contact.customer;
  return {
    contactId: contact.id,
    name: contact.name,
    phone: contact.phone,
    email: scope.email,
    customerName: c.displayName,
    isCompany: c.type === "COMPANY",
    billing: {
      billingLine1: c.billingLine1,
      billingLine2: c.billingLine2,
      billingSuburb: c.billingSuburb,
      billingCity: c.billingCity,
      billingPostalCode: c.billingPostalCode,
    },
    consentRecorded: c.consentAt !== null,
    remaining: pending.length,
  };
}

/**
 * Saves the welcome for one contact of the signed-in person: their name and phone, the billing address of
 * the contact's OWN customer (an agency's own address, never a complex's), and the privacy consent on that
 * customer if none is recorded yet. Lock order: the customer, then the contact is re-read under the lock.
 * Call inside a transaction.
 */
export async function completeWelcome(
  store: Pick<Db, "contact" | "customer" | "auditLog">,
  scope: PortalScope,
  input: WelcomeInput,
  now: Date = new Date(),
): Promise<void> {
  const target = scope.contacts.find((c) => c.id === input.contactId);
  if (!target) throw new DomainError(WELCOME_GONE);
  await findEditableCustomerNarrow(store, target.customerId);
  await lockCustomer(store, target.customerId);
  const contact = await store.contact.findFirst({
    where: {
      id: target.id,
      customerId: target.customerId,
      email: scope.email,
      portalAccess: true,
      portalWelcomedAt: null,
    },
    select: { id: true, name: true, phone: true },
  });
  if (!contact) throw new DomainError(WELCOME_GONE);
  const customer = await store.customer.findUniqueOrThrow({
    where: { id: target.customerId },
    select: {
      status: true,
      billingLine1: true,
      billingLine2: true,
      billingSuburb: true,
      billingCity: true,
      billingPostalCode: true,
      consentAt: true,
    },
  });
  if (customer.status === "ARCHIVED") throw new DomainError(WELCOME_GONE);

  const person = { name: input.name, phone: input.phone };
  const billing = {
    billingLine1: input.billingLine1,
    billingLine2: input.billingLine2,
    billingSuburb: input.billingSuburb,
    billingCity: input.billingCity,
    billingPostalCode: input.billingPostalCode,
  };
  const recordConsent = customer.consentAt === null;
  await store.contact.update({
    where: { id: contact.id },
    data: { ...person, portalWelcomedAt: now },
    select: { id: true },
  });
  await store.customer.update({
    where: { id: target.customerId },
    data: { ...billing, ...(recordConsent ? { consentAt: now, consentSource: "portal" } : {}) },
    select: { id: true },
  });
  await logCustomerEventAs(store, clientParty(target.customerId), "customer.portal_welcomed", target.customerId, {
    contactId: contact.id,
    changed: [...changedFields(contact, person), ...changedFields(customer, billing)],
    consentRecorded: recordConsent,
  });
}
```

Append to `packages/core/src/portal/index.ts`:

```ts
export { welcomeSchema, type WelcomeInput } from "./welcome-schema";
export { WELCOME_GONE, completeWelcome, getWelcomeStep, type WelcomeStep } from "./welcome";
```

- [ ] **Step 4: Run, check and commit**

```bash
cd packages/core && npx vitest run src/portal/welcome-schema.test.ts && cd ../..
npx prettier --write packages/core/src/portal/welcome-schema.ts packages/core/src/portal/welcome-schema.test.ts packages/core/src/portal/welcome.ts packages/core/src/portal/welcome.db.test.ts packages/core/src/portal/index.ts
npm run typecheck
npm run lint
npm run test
git add packages/core/src/portal/welcome-schema.ts packages/core/src/portal/welcome-schema.test.ts packages/core/src/portal/welcome.ts packages/core/src/portal/welcome.db.test.ts packages/core/src/portal/index.ts
git commit -m "Add the portal welcome: name, phone, own billing address and consent, one contact at a time

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: all pass (the database test runs in the controller's `test:db`).

---
### Task 8: Quotes and My complexes for a scope (portal accept and decline)

**Files:**
- Modify: `packages/core/src/quotes/acceptance.ts` (method `CLIENT_PORTAL`, `acceptedByContactId`, decline `via`)
- Modify: `packages/core/src/quotes/outcomes.ts` (`reverseAcceptance` clears `acceptedByContactId`)
- Modify: `packages/core/src/quotes/public.ts` (export `PUBLIC_QUOTE_SELECT`, new `buildPublicView`, `PublicQuoteView`, `PublicQuoteRow`)
- Create: `packages/core/src/portal/quotes.ts`
- Create: `packages/core/src/portal/home.ts`, `packages/core/src/portal/home.test.ts`
- Create: `packages/core/src/portal/portal-quotes.db.test.ts`
- Modify: `packages/core/src/portal/index.ts`

**Interfaces:**
- Consumes: `acceptCore`, `declineCore`, `QuoteExpiredError`, `QuoteNotIssuedError` (`quotes/acceptance.ts`, imported directly: they are not in the barrel); `clientParty` (`audit.ts`); `findEditableCustomerNarrow`, `lockCustomer` (`customers/store.ts`); `publicViewState` (`quotes/public-state.ts`); `formatDateSA`, `formatQuoteReference`, `todaySA`, `addDays`, `QuoteStatusValue` (`quotes/reference.ts`); `LinkAcceptInput`, `LinkDeclineInput` (`quotes/public.ts`); `loadPortalScope`, `pickActingContact`, `PortalScope` (Tasks 3 and 6); `PortalStore` (Task 6); test helpers `asPortal`, `makeClient`, `issueFor`, `scopeOf` (Task 6); `findQuote`, `withdrawQuote`, `createQuote`, `revokeQuoteLink`, `reverseAcceptance`, `monthlyLine`, `optionalLine`, `owner`, `manager`, `token` (quotes).
- Produces:
  - `acceptance.ts`: `AcceptContext.method` also accepts `"CLIENT_PORTAL"`; new optional `AcceptContext.acceptedByContactId?: string | null | undefined` (written to the quote; null for staff and the link); `declineCore` ctx gains optional `via?: "portal" | undefined` (audit `after: { via: "portal" }` when given).
  - `public.ts`: `PUBLIC_QUOTE_SELECT` (exported); `type PublicQuoteRow`; `type PublicQuoteView = { state: PublicViewState; reference: string; doc: QuoteDocument; optionalLines: { id: string; label: string }[]; acceptance: { name: string | null; at: string; startDate: string | null; chosen: string[] } | null; declinedAt: string | null; business: { tradingName: string; phone: string; email: string } }`; `buildPublicView(q: PublicQuoteRow, today: string): PublicQuoteView | null` (pure; null for a draft); `PublicQuoteResult` becomes `{ found: false } | ({ found: true; newerToken: string | null } & PublicQuoteView)` (same fields as before).
  - `portal/quotes.ts`: `PORTAL_VISIBLE_STATUSES = ["ISSUED", "ACCEPTED", "DECLINED"] as const`; `type PortalQuoteView = PublicQuoteView & { id: string }`; `getPortalQuote(store: PortalStore, scope: PortalScope, quoteId: string, now?: Date): Promise<PortalQuoteView | null>`; `type PortalAcceptResult = { outcome: "ACCEPTED"; customerFlag: "PAUSED" | "ARCHIVED" | null; quoteId: string } | { outcome: "ALREADY_ACCEPTED" } | { outcome: "EXPIRED" } | { outcome: "NOT_AVAILABLE" } | { outcome: "NOT_FOUND" }`; `acceptPortalQuote(store: PortalStore, scope: PortalScope, quoteId: string, input: LinkAcceptInput, ctx: { ip: string | null; userAgent: string | null }): Promise<PortalAcceptResult>`; `type PortalDeclineResult = { outcome: "DECLINED" } | { outcome: "ALREADY_DECLINED" } | { outcome: "NOT_AVAILABLE" } | { outcome: "NOT_FOUND" }`; `declinePortalQuote(store: PortalStore, scope: PortalScope, quoteId: string, input: LinkDeclineInput): Promise<PortalDeclineResult>`.
  - `portal/home.ts`: `type PortalQuoteState = "OPEN" | "EXPIRED" | "ACCEPTED" | "DECLINED"`; `type PortalQuoteSummary = { id: string; reference: string; state: PortalQuoteState; issuedDate: string | null; validUntil: string }`; `type PortalPropertyGroup = { id: string; label: string; address: string; quotes: PortalQuoteSummary[] }`; `type PortalCustomerGroup = { id: string; name: string; status: CustomerStatus; managed: boolean; properties: PortalPropertyGroup[]; otherQuotes: PortalQuoteSummary[] }`; `type PortalHome = { hasManaged: boolean; groups: PortalCustomerGroup[] }`; `type HomeQuoteRow = { id: string; customerId: string; propertyId: string; status: QuoteStatusValue; numberYear: number | null; numberSeq: number | null; revision: number; validUntil: Date; issuedAt: Date | null }`; `groupPortalHome(input: { customers: { id: string; displayName: string; status: CustomerStatus }[]; properties: { id: string; customerId: string; label: string; addressLine1: string; addressLine2: string | null; suburb: string | null; city: string | null; postalCode: string | null }[]; quotes: HomeQuoteRow[]; managedCustomerIds: readonly string[]; today: string }): PortalCustomerGroup[]` (pure); `getPortalHome(store: PortalStore, scope: PortalScope, opts?: { q?: string }, now?: Date): Promise<PortalHome>`.

Authority rules (enforced inside every query): the quote's customer must be in `scope.customerIds` and its status in `PORTAL_VISIBLE_STATUSES`; a revoked private link does not hide a quote. Accept and decline find the quote, lock its customer, then recompute the scope from live data and find the quote again before `acceptCore` / `declineCore` run (a complex moved to another agency, or access removed, mid-request is refused). The acting contact is the person's contact at the quote's customer, else at its managing agency; the audit actor is `clientParty(<acting contact's customer id>)`, so an agency's act is recorded as done for the agency.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/portal/home.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fromDateString } from "../quotes/reference";
import { groupPortalHome, type HomeQuoteRow } from "./home";

const agency = "a0000000-0000-4000-8000-000000000001";
const complex = "c0000000-0000-4000-8000-000000000001";
const today = "2026-11-23";

const quote = (over: Partial<HomeQuoteRow> & { id: string; customerId: string; propertyId: string }): HomeQuoteRow => ({
  status: "ISSUED",
  numberYear: 2026,
  numberSeq: 1,
  revision: 1,
  validUntil: fromDateString("2026-12-31"),
  issuedAt: new Date("2026-11-01T08:00:00.000Z"),
  ...over,
});

describe("groupPortalHome", () => {
  const groups = groupPortalHome({
    customers: [
      { id: complex, displayName: "ZZ Complex Bravo", status: "ACTIVE" },
      { id: agency, displayName: "ZZ Agency Alpha", status: "ACTIVE" },
    ],
    properties: [
      { id: "p2", customerId: complex, label: "Block B", addressLine1: "2 ZZ Road", addressLine2: null, suburb: "ZZ Suburb", city: null, postalCode: "7441" },
      { id: "p1", customerId: complex, label: "Block A", addressLine1: "1 ZZ Road", addressLine2: null, suburb: null, city: null, postalCode: null },
      { id: "pa", customerId: agency, label: "Office", addressLine1: "9 ZZ Street", addressLine2: null, suburb: null, city: null, postalCode: null },
    ],
    quotes: [
      quote({ id: "open", customerId: agency, propertyId: "pa", numberSeq: 5 }),
      quote({ id: "accepted", customerId: complex, propertyId: "p1", status: "ACCEPTED", numberSeq: 6, issuedAt: new Date("2026-11-10T08:00:00.000Z") }),
      quote({ id: "expired", customerId: complex, propertyId: "p1", numberSeq: 7, validUntil: fromDateString("2026-11-01") }),
      quote({ id: "orphan", customerId: complex, propertyId: "archived-property", status: "DECLINED", numberSeq: 8, revision: 2 }),
      quote({ id: "withdrawn", customerId: complex, propertyId: "p1", status: "WITHDRAWN", numberSeq: 9 }),
    ],
    managedCustomerIds: [complex],
    today,
  });

  it("puts own customers first, then managed complexes, each by name", () => {
    expect(groups.map((g) => [g.name, g.managed])).toEqual([
      ["ZZ Agency Alpha", false],
      ["ZZ Complex Bravo", true],
    ]);
  });
  it("lists properties by label with a one-line address", () => {
    expect(groups[1]?.properties.map((p) => [p.label, p.address])).toEqual([
      ["Block A", "1 ZZ Road"],
      ["Block B", "2 ZZ Road, ZZ Suburb, 7441"],
    ]);
  });
  it("shows each quote's state and reference, newest first, and never a withdrawn one", () => {
    expect(groups[1]?.properties[0]?.quotes.map((q) => [q.id, q.state, q.reference])).toEqual([
      ["accepted", "ACCEPTED", "QUO-2026-0006"],
      ["expired", "EXPIRED", "QUO-2026-0007"],
    ]);
    expect(groups[0]?.properties[0]?.quotes.map((q) => [q.id, q.state])).toEqual([["open", "OPEN"]]);
    const all = groups.flatMap((g) => [...g.properties.flatMap((p) => p.quotes), ...g.otherQuotes]);
    expect(all.map((q) => q.id)).not.toContain("withdrawn");
  });
  it("keeps a quote whose property is no longer listed under 'other quotes'", () => {
    expect(groups[1]?.otherQuotes.map((q) => [q.id, q.state, q.reference])).toEqual([
      ["orphan", "DECLINED", "QUO-2026-0008 R2"],
    ]);
  });
});
```

`packages/core/src/portal/portal-quotes.db.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createQuote } from "../quotes/drafts";
import { withdrawQuote } from "../quotes/issue";
import { revokeQuoteLink } from "../quotes/link";
import { reverseAcceptance } from "../quotes/outcomes";
import { addDays, todaySA } from "../quotes/reference";
import { findQuote } from "../quotes/store";
import { manager, monthlyLine, optionalLine, owner, token } from "../quotes/test-helpers";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { getPortalHome } from "./home";
import { acceptPortalQuote, declinePortalQuote, getPortalQuote } from "./quotes";
import { asPortal, issueFor, makeClient, scopeOf } from "./test-helpers";

const ctx = { ip: "203.0.113.44", userAgent: "ZZ Test Browser" };
const accept = (acceptedBy: string, chosenLineIds: string[] = []) => ({
  acceptedBy,
  startDate: addDays(todaySA(), 4),
  chosenLineIds,
});

// Each issued quote costs about 10 seconds; no test below issues more than two.

describe.skipIf(!dbTestsEnabled)("portal quotes, run as ace_portal", () => {
  it("lets an agency see and accept its complexes' quotes, and keeps a trustee to their own complex", async () => {
    await withRollback(async (tx) => {
      const agency = await makeClient(tx, { name: `ZZ E2E Agency ${token()}` });
      const x = await makeClient(tx, { managedById: agency.customerId, name: `ZZ E2E Complex ${token()}` });
      const y = await makeClient(tx, { managedById: agency.customerId, name: `ZZ E2E Complex ${token()}` });
      const qx = await issueFor(tx, x);
      const qy = await issueFor(tx, y, { lines: [monthlyLine(), optionalLine()] });
      const optionId = (await findQuote(tx, qy)).lines[1]!.id;

      await asPortal(tx, async () => {
        const agencyScope = await scopeOf(tx, agency.email);
        const trusteeScope = await scopeOf(tx, x.email);

        const agencyHome = await getPortalHome(tx, agencyScope);
        expect(agencyHome.hasManaged).toBe(true);
        expect(agencyHome.groups.map((g) => g.id).sort()).toEqual(
          [agency.customerId, x.customerId, y.customerId].sort(),
        );
        const trusteeHome = await getPortalHome(tx, trusteeScope);
        expect(trusteeHome.hasManaged).toBe(false);
        expect(trusteeHome.groups.map((g) => g.id)).toEqual([x.customerId]);
        expect(trusteeHome.groups[0]?.properties[0]?.quotes.map((q) => q.id)).toEqual([qx]);
        const searched = await getPortalHome(tx, agencyScope, { q: y.name.slice(-10) });
        expect(searched.groups.map((g) => g.id)).toEqual([y.customerId]);

        // A trustee of complex X cannot reach complex Y's quote by its id.
        expect(await getPortalQuote(tx, trusteeScope, qy)).toBeNull();
        expect(await acceptPortalQuote(tx, trusteeScope, qy, accept("ZZ Trustee"), ctx)).toEqual({
          outcome: "NOT_FOUND",
        });
        expect(await declinePortalQuote(tx, trusteeScope, qy, {})).toEqual({ outcome: "NOT_FOUND" });

        const view = await getPortalQuote(tx, agencyScope, qy);
        expect(view?.state).toBe("OPEN");
        expect(view?.id).toBe(qy);
        expect(JSON.stringify(view)).not.toContain("@example.com");
        expect(
          await acceptPortalQuote(tx, agencyScope, qy, accept("ZZ E2E Agency Person", [optionId]), ctx),
        ).toEqual({ outcome: "ACCEPTED", customerFlag: null, quoteId: qy });
        // A double click is recorded once.
        expect(await acceptPortalQuote(tx, agencyScope, qy, accept("ZZ E2E Agency Person"), ctx)).toEqual({
          outcome: "ALREADY_ACCEPTED",
        });
      });

      const after = await findQuote(tx, qy);
      expect(after).toMatchObject({
        status: "ACCEPTED",
        acceptedMethod: "CLIENT_PORTAL",
        acceptedByContactId: agency.contactId,
        acceptedByName: "ZZ E2E Agency Person",
        acceptedByStaffId: null,
        acceptedIp: ctx.ip,
        acceptedUserAgent: ctx.userAgent,
      });
      expect(after.lines.map((l) => l.chosen)).toEqual([false, true]);
      expect((await findQuote(tx, qx)).status).toBe("ISSUED");

      const audit = await tx.auditLog.findMany({ where: { entityId: qy, action: "quote.accepted" } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actorType: "CUSTOMER", actorId: agency.customerId, ip: null, userAgent: null });
      expect(audit[0]?.after).toMatchObject({ method: "CLIENT_PORTAL", optionsChosen: 1 });
      const text = JSON.stringify(audit);
      for (const typed of ["ZZ E2E Agency Person", ctx.ip, ctx.userAgent, agency.email]) {
        expect(text).not.toContain(typed);
      }

      // A staff reversal also clears who accepted in the portal.
      await reverseAcceptance(tx, owner, qy, "ZZ test reversal");
      expect((await findQuote(tx, qy)).acceptedByContactId).toBeNull();
    });
  });

  it("refuses a request whose scope went stale: a complex moved agency, or the person's access was removed", async () => {
    await withRollback(async (tx) => {
      const first = await makeClient(tx);
      const second = await makeClient(tx);
      const complex = await makeClient(tx, { managedById: first.customerId });
      const q = await issueFor(tx, complex);
      const staleAgency = await scopeOf(tx, first.email);
      const staleTrustee = await scopeOf(tx, complex.email);
      expect(staleAgency.customerIds).toContain(complex.customerId);

      await tx.customer.update({ where: { id: complex.customerId }, data: { managedById: second.customerId } });
      await tx.contact.update({ where: { id: complex.contactId }, data: { portalAccess: false } });

      await asPortal(tx, async () => {
        expect((await scopeOf(tx, first.email)).customerIds).not.toContain(complex.customerId);
        expect((await scopeOf(tx, second.email)).customerIds).toContain(complex.customerId);
        expect(await acceptPortalQuote(tx, staleAgency, q, accept("ZZ Old Agency"), ctx)).toEqual({
          outcome: "NOT_FOUND",
        });
        // The trustee's old scope still finds the quote; the fresh check under the customer lock refuses it.
        expect(await acceptPortalQuote(tx, staleTrustee, q, accept("ZZ Trustee"), ctx)).toEqual({
          outcome: "NOT_FOUND",
        });
        expect(await declinePortalQuote(tx, staleTrustee, q, {})).toEqual({ outcome: "NOT_FOUND" });
      });
      expect((await findQuote(tx, q)).status).toBe("ISSUED");
    });
  });

  it("shows only issued, accepted and declined quotes, declines in the portal, and ignores a revoked link", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const open = await issueFor(tx, client);
      const withdrawn = await issueFor(tx, client);
      await withdrawQuote(tx, manager, withdrawn);
      const { id: draft } = await createQuote(tx, manager, {
        customerId: client.customerId,
        propertyId: client.propertyId,
      });
      await revokeQuoteLink(tx, manager, open);

      await asPortal(tx, async () => {
        const scope = await scopeOf(tx, client.email);
        const home = await getPortalHome(tx, scope);
        const ids = home.groups.flatMap((g) => [...g.properties.flatMap((p) => p.quotes), ...g.otherQuotes]).map((q) => q.id);
        expect(ids).toEqual([open]);
        expect(await getPortalQuote(tx, scope, withdrawn)).toBeNull();
        expect(await getPortalQuote(tx, scope, draft)).toBeNull();
        expect(await getPortalQuote(tx, scope, "not-a-uuid")).toBeNull();
        expect((await getPortalQuote(tx, scope, open))?.state).toBe("OPEN");
        expect(await acceptPortalQuote(tx, scope, withdrawn, accept("ZZ Client"), ctx)).toEqual({
          outcome: "NOT_FOUND",
        });
        expect(await declinePortalQuote(tx, scope, open, { reason: "ZZ too dear" })).toEqual({ outcome: "DECLINED" });
        expect(await declinePortalQuote(tx, scope, open, {})).toEqual({ outcome: "ALREADY_DECLINED" });
        expect(await acceptPortalQuote(tx, scope, open, accept("ZZ Client"), ctx)).toEqual({
          outcome: "NOT_AVAILABLE",
        });
        expect((await getPortalQuote(tx, scope, open))?.state).toBe("DECLINED");
      });

      expect(await findQuote(tx, open)).toMatchObject({
        status: "DECLINED",
        declinedByClient: true,
        declineReason: "ZZ too dear",
        linkToken: null,
      });
      const audit = await tx.auditLog.findMany({ where: { entityId: open, action: "quote.declined" } });
      expect(audit[0]).toMatchObject({ actorType: "CUSTOMER", actorId: client.customerId });
      expect(audit[0]?.after).toEqual({ via: "portal" });
      expect(JSON.stringify(audit)).not.toContain("ZZ too dear");
    });
  });
});
```

Run `cd packages/core && npx vitest run src/portal/home.test.ts && cd ../..`: expect FAIL (module missing).

- [ ] **Step 2: Shared acceptance changes**

In `packages/core/src/quotes/acceptance.ts`:

- in `AcceptContext`, change the `method` line to
  `method: "WHATSAPP" | "EMAIL" | "PHONE" | "IN_PERSON" | "SIGNED_COPY" | "CLIENT_LINK" | "CLIENT_PORTAL";`
  and add after `expectLinkToken`:

```ts
  /** Set by the client portal: the signed-in contact who accepted. Staff and the link leave it out. */
  acceptedByContactId?: string | null | undefined;
```

- in `acceptCore`'s `store.quote.update` data, add `acceptedByContactId: ctx.acceptedByContactId ?? null,` directly after `acceptedUserAgent: ctx.userAgent,`;
- change `declineCore`'s `ctx` parameter type to
  `ctx: { audit: AuditParty; declinedByClient: boolean; expectLinkToken?: string | undefined; via?: "portal" | undefined },`
  and its last line to
  `await logQuoteEventAs(store, ctx.audit, "quote.declined", quoteId, ctx.via ? { via: ctx.via } : undefined);`

In `packages/core/src/quotes/outcomes.ts`, in `reverseAcceptance`'s `store.quote.update` data, add `acceptedByContactId: null,` after `acceptedUserAgent: null,`.

- [ ] **Step 3: `buildPublicView` in `packages/core/src/quotes/public.ts`**

Change `const PUBLIC_QUOTE_SELECT = {` to `export const PUBLIC_QUOTE_SELECT = {`. Replace the `PublicQuoteResult` type and the whole `getPublicQuote` function with:

```ts
export type PublicQuoteRow = Prisma.QuoteGetPayload<{ select: typeof PUBLIC_QUOTE_SELECT }>;

/** What a client may see of one quote: name and property address only, never email, phone or notes. */
export type PublicQuoteView = {
  state: PublicViewState;
  reference: string;
  doc: QuoteDocument;
  optionalLines: { id: string; label: string }[];
  acceptance: {
    name: string | null;
    at: string;
    startDate: string | null;
    chosen: string[];
  } | null;
  declinedAt: string | null;
  business: { tradingName: string; phone: string; email: string };
};

export type PublicQuoteResult =
  | { found: false }
  | ({ found: true; newerToken: string | null } & PublicQuoteView);

/** Shapes a quote row for a client (the private link and the portal use the same view). Null for a draft. */
export function buildPublicView(q: PublicQuoteRow, today: string): PublicQuoteView | null {
  const state = publicViewState(q, today);
  if (!state) return null;
  const wording = wordingSnapshotSchema.parse(q.wordingSnapshot);
  const reference = formatQuoteReference(q) ?? "";
  const lines = q.lines.map((l) => ({
    id: l.id,
    lineKind: l.lineKind,
    billing: l.billing,
    frequency: l.frequency,
    description: l.description,
    amountCents: l.amountCents,
    chosen: l.chosen,
  }));
  const doc = buildQuoteDocument({
    status: displayStatus(q, today),
    reference,
    issuedDate: q.issuedAt ? formatDateSA(q.issuedAt) : null,
    validUntil: formatDateSA(q.validUntil),
    // Name and property address only: the email and phone are never read.
    preparedFor: {
      name: q.recipientName ?? "Anonymised customer",
      email: null,
      phone: null,
      siteLabel: q.siteLabel ?? "",
      siteAddress: q.siteAddress ?? "",
    },
    scope: q.scopeItems,
    lines,
    wording,
  });
  const optionalLines = lines
    .filter((l) => l.lineKind === "OPTIONAL")
    .map((l) => ({
      id: l.id,
      label: `${l.description} (${formatZAR(l.amountCents ?? 0)}${l.billing === "MONTHLY" ? " per month" : ""})`,
    }));
  const acceptance =
    state === "ACCEPTED" && q.acceptedAt
      ? {
          name: q.acceptedByName,
          at: formatDateTimeSA(q.acceptedAt),
          startDate: q.acceptedStartDate ? formatDateSA(q.acceptedStartDate) : null,
          chosen: lines
            .filter((l) => l.lineKind === "OPTIONAL" && l.chosen)
            .map((l) => `${l.description} (${formatZAR(l.amountCents ?? 0)})`),
        }
      : null;
  return {
    state,
    reference,
    doc,
    optionalLines,
    acceptance,
    declinedAt: q.declinedAt ? formatDateTimeSA(q.declinedAt) : null,
    business: {
      tradingName: wording.business.tradingName,
      phone: wording.business.phone,
      email: wording.business.email,
    },
  };
}

/** Finds a quote by its private code. Wrong, malformed, revoked and draft codes all give `{ found: false }`. */
export async function getPublicQuote(
  store: PublicStore,
  token: string,
  now: Date = new Date(),
): Promise<PublicQuoteResult> {
  if (!isLinkTokenShape(token)) return { found: false };
  const q = await store.quote.findUnique({
    where: { linkToken: token },
    select: PUBLIC_QUOTE_SELECT,
  });
  if (!q) return { found: false };
  const view = buildPublicView(q, todaySA(now));
  if (!view) return { found: false };

  let newerToken: string | null = null;
  if (view.state === "REPLACED" && q.numberYear !== null && q.numberSeq !== null) {
    const newer = await store.quote.findFirst({
      where: {
        numberYear: q.numberYear,
        numberSeq: q.numberSeq,
        revision: { gt: q.revision },
        status: { in: ["ISSUED", "ACCEPTED"] },
        linkToken: { not: null },
      },
      orderBy: { revision: "desc" },
      select: { linkToken: true },
    });
    newerToken = newer?.linkToken ?? null;
  }
  return { found: true, ...view, newerToken };
}
```

Keep every import `public.ts` already has (they are all still used). The existing `public.db.test.ts` must keep passing unchanged.

- [ ] **Step 4: Write `packages/core/src/portal/quotes.ts`**

```ts
import { z } from "zod";
import { clientParty } from "../audit";
import { findEditableCustomerNarrow, lockCustomer } from "../customers/store";
import {
  QuoteExpiredError,
  QuoteNotIssuedError,
  acceptCore,
  declineCore,
} from "../quotes/acceptance";
import {
  PUBLIC_QUOTE_SELECT,
  buildPublicView,
  type LinkAcceptInput,
  type LinkDeclineInput,
  type PublicQuoteView,
} from "../quotes/public";
import { todaySA } from "../quotes/reference";
import { loadPortalScope, pickActingContact, type PortalScope } from "./scope";
import type { PortalStore } from "./store";

/** Quotes a client may see in the portal: issued (open or expired), accepted, declined. */
export const PORTAL_VISIBLE_STATUSES = ["ISSUED", "ACCEPTED", "DECLINED"] as const;

const isUuid = (value: string) => z.uuid().safeParse(value).success;

export type PortalQuoteView = PublicQuoteView & { id: string };

/** One quote, if its customer is in the scope and it is visible. Anything else is null (shown as not found). */
export async function getPortalQuote(
  store: PortalStore,
  scope: PortalScope,
  quoteId: string,
  now: Date = new Date(),
): Promise<PortalQuoteView | null> {
  if (!isUuid(quoteId)) return null;
  const q = await store.quote.findFirst({
    where: {
      id: quoteId,
      customerId: { in: [...scope.customerIds] },
      status: { in: [...PORTAL_VISIBLE_STATUSES] },
    },
    select: PUBLIC_QUOTE_SELECT,
  });
  if (!q) return null;
  const view = buildPublicView(q, todaySA(now));
  return view ? { id: q.id, ...view } : null;
}

/** The quote (restricted to the scope inside the query) and who would act on it. */
async function findActable(store: PortalStore, scope: PortalScope, quoteId: string) {
  if (!isUuid(quoteId)) return null;
  const quote = await store.quote.findFirst({
    where: {
      id: quoteId,
      customerId: { in: [...scope.customerIds] },
      status: { in: [...PORTAL_VISIBLE_STATUSES] },
    },
    select: { id: true, customerId: true, status: true, customer: { select: { id: true, managedById: true } } },
  });
  if (!quote) return null;
  const acting = pickActingContact(scope, quote.customer);
  return acting ? { quote, acting } : null;
}

/**
 * Locks the quote's customer (customer before quote, as everywhere), then recomputes the scope from live
 * data and finds the quote again: a complex moved to another agency, or access removed, after the request
 * started is refused here. Linking and access changes take the same customer lock.
 */
async function findActableUnderLock(
  store: PortalStore,
  scope: PortalScope,
  quoteId: string,
  customerId: string,
) {
  await findEditableCustomerNarrow(store, customerId);
  await lockCustomer(store, customerId);
  const fresh = await loadPortalScope(store, scope.email);
  return fresh ? findActable(store, fresh, quoteId) : null;
}

export type PortalAcceptResult =
  | { outcome: "ACCEPTED"; customerFlag: "PAUSED" | "ARCHIVED" | null; quoteId: string }
  | { outcome: "ALREADY_ACCEPTED" }
  | { outcome: "EXPIRED" }
  | { outcome: "NOT_AVAILABLE" }
  | { outcome: "NOT_FOUND" };

/**
 * The signed-in client accepts an open quote: the shared acceptance routine with method CLIENT_PORTAL, the
 * acting contact's id, and the same proof as the link. Call inside a transaction. Plain DomainErrors (a past
 * start date, a line that is not an add-on) propagate.
 */
export async function acceptPortalQuote(
  store: PortalStore,
  scope: PortalScope,
  quoteId: string,
  input: LinkAcceptInput,
  ctx: { ip: string | null; userAgent: string | null },
): Promise<PortalAcceptResult> {
  const found = await findActable(store, scope, quoteId);
  if (!found) return { outcome: "NOT_FOUND" };
  if (found.quote.status === "ACCEPTED") return { outcome: "ALREADY_ACCEPTED" };
  if (found.quote.status !== "ISSUED") return { outcome: "NOT_AVAILABLE" };
  try {
    const again = await findActableUnderLock(store, scope, quoteId, found.quote.customerId);
    if (!again) return { outcome: "NOT_FOUND" };
    const { customerFlag } = await acceptCore(
      store,
      {
        audit: clientParty(again.acting.customerId),
        method: "CLIENT_PORTAL",
        staffId: null,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        acceptedByContactId: again.acting.contactId,
      },
      quoteId,
      input,
    );
    return { outcome: "ACCEPTED", customerFlag, quoteId };
  } catch (error) {
    if (error instanceof QuoteExpiredError) return { outcome: "EXPIRED" };
    if (error instanceof QuoteNotIssuedError) {
      return error.status === "ACCEPTED" ? { outcome: "ALREADY_ACCEPTED" } : { outcome: "NOT_AVAILABLE" };
    }
    throw error;
  }
}

export type PortalDeclineResult =
  | { outcome: "DECLINED" }
  | { outcome: "ALREADY_DECLINED" }
  | { outcome: "NOT_AVAILABLE" }
  | { outcome: "NOT_FOUND" };

/** The signed-in client declines an issued quote. Call inside a transaction. */
export async function declinePortalQuote(
  store: PortalStore,
  scope: PortalScope,
  quoteId: string,
  input: LinkDeclineInput,
): Promise<PortalDeclineResult> {
  const found = await findActable(store, scope, quoteId);
  if (!found) return { outcome: "NOT_FOUND" };
  if (found.quote.status === "DECLINED") return { outcome: "ALREADY_DECLINED" };
  if (found.quote.status !== "ISSUED") return { outcome: "NOT_AVAILABLE" };
  try {
    const again = await findActableUnderLock(store, scope, quoteId, found.quote.customerId);
    if (!again) return { outcome: "NOT_FOUND" };
    await declineCore(
      store,
      { audit: clientParty(again.acting.customerId), declinedByClient: true, via: "portal" },
      quoteId,
      input,
    );
    return { outcome: "DECLINED" };
  } catch (error) {
    if (error instanceof QuoteNotIssuedError) {
      return error.status === "DECLINED" ? { outcome: "ALREADY_DECLINED" } : { outcome: "NOT_AVAILABLE" };
    }
    throw error;
  }
}
```

- [ ] **Step 5: Write `packages/core/src/portal/home.ts`**

```ts
import type { CustomerStatus } from "../generated/prisma/enums";
import { publicViewState } from "../quotes/public-state";
import { formatDateSA, formatQuoteReference, todaySA, type QuoteStatusValue } from "../quotes/reference";
import { PORTAL_VISIBLE_STATUSES } from "./quotes";
import type { PortalScope } from "./scope";
import type { PortalStore } from "./store";

export type PortalQuoteState = "OPEN" | "EXPIRED" | "ACCEPTED" | "DECLINED";

export type PortalQuoteSummary = {
  id: string;
  reference: string;
  state: PortalQuoteState;
  issuedDate: string | null;
  validUntil: string;
};

export type PortalPropertyGroup = {
  id: string;
  label: string;
  address: string;
  quotes: PortalQuoteSummary[];
};

export type PortalCustomerGroup = {
  id: string;
  name: string;
  status: CustomerStatus;
  /** True for a complex seen through its managing agency. */
  managed: boolean;
  properties: PortalPropertyGroup[];
  /** Quotes for a property that is no longer listed (for example archived). */
  otherQuotes: PortalQuoteSummary[];
};

export type PortalHome = { hasManaged: boolean; groups: PortalCustomerGroup[] };

export type HomeQuoteRow = {
  id: string;
  customerId: string;
  propertyId: string;
  status: QuoteStatusValue;
  numberYear: number | null;
  numberSeq: number | null;
  revision: number;
  validUntil: Date;
  issuedAt: Date | null;
};

const SHOWN: readonly string[] = ["OPEN", "EXPIRED", "ACCEPTED", "DECLINED"];

/** Groups the rows by customer and property. Pure, so the shape is unit-tested without a database. */
export function groupPortalHome(input: {
  customers: { id: string; displayName: string; status: CustomerStatus }[];
  properties: {
    id: string;
    customerId: string;
    label: string;
    addressLine1: string;
    addressLine2: string | null;
    suburb: string | null;
    city: string | null;
    postalCode: string | null;
  }[];
  quotes: HomeQuoteRow[];
  managedCustomerIds: readonly string[];
  today: string;
}): PortalCustomerGroup[] {
  const managed = new Set(input.managedCustomerIds);
  const byCustomer = new Map<string, PortalCustomerGroup>();
  for (const c of input.customers) {
    byCustomer.set(c.id, {
      id: c.id,
      name: c.displayName,
      status: c.status,
      managed: managed.has(c.id),
      properties: [],
      otherQuotes: [],
    });
  }
  const byProperty = new Map<string, PortalPropertyGroup>();
  for (const p of [...input.properties].sort((a, b) => a.label.localeCompare(b.label))) {
    const group = byCustomer.get(p.customerId);
    if (!group) continue;
    const property: PortalPropertyGroup = {
      id: p.id,
      label: p.label,
      address: [p.addressLine1, p.addressLine2, p.suburb, p.city, p.postalCode].filter(Boolean).join(", "),
      quotes: [],
    };
    group.properties.push(property);
    byProperty.set(p.id, property);
  }
  const newestFirst = [...input.quotes].sort(
    (a, b) => (b.issuedAt?.getTime() ?? 0) - (a.issuedAt?.getTime() ?? 0),
  );
  for (const q of newestFirst) {
    const state = publicViewState(q, input.today);
    if (!state || !SHOWN.includes(state)) continue;
    const summary: PortalQuoteSummary = {
      id: q.id,
      reference: formatQuoteReference(q) ?? "",
      state: state as PortalQuoteState,
      issuedDate: q.issuedAt ? formatDateSA(q.issuedAt) : null,
      validUntil: formatDateSA(q.validUntil),
    };
    const property = byProperty.get(q.propertyId);
    if (property) property.quotes.push(summary);
    else byCustomer.get(q.customerId)?.otherQuotes.push(summary);
  }
  return [...byCustomer.values()].sort(
    (a, b) => Number(a.managed) - Number(b.managed) || a.name.localeCompare(b.name),
  );
}

/**
 * The home page: every customer in the scope (own first, then managed complexes) with its properties and
 * quotes. `q` filters by customer (complex) name. Every query is restricted to the scope.
 */
export async function getPortalHome(
  store: PortalStore,
  scope: PortalScope,
  opts: { q?: string } = {},
  now: Date = new Date(),
): Promise<PortalHome> {
  const term = (opts.q ?? "").trim().slice(0, 80);
  const customers = await store.customer.findMany({
    where: {
      id: { in: [...scope.customerIds] },
      ...(term ? { displayName: { contains: term, mode: "insensitive" as const } } : {}),
    },
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, status: true },
  });
  const ids = customers.map((c) => c.id);
  const properties =
    ids.length === 0
      ? []
      : await store.property.findMany({
          where: { customerId: { in: ids }, archivedAt: null },
          orderBy: { label: "asc" },
          select: {
            id: true,
            customerId: true,
            label: true,
            addressLine1: true,
            addressLine2: true,
            suburb: true,
            city: true,
            postalCode: true,
          },
        });
  const quotes =
    ids.length === 0
      ? []
      : await store.quote.findMany({
          where: { customerId: { in: ids }, status: { in: [...PORTAL_VISIBLE_STATUSES] } },
          orderBy: { issuedAt: "desc" },
          select: {
            id: true,
            customerId: true,
            propertyId: true,
            status: true,
            numberYear: true,
            numberSeq: true,
            revision: true,
            validUntil: true,
            issuedAt: true,
          },
        });
  return {
    hasManaged: scope.managedCustomerIds.length > 0,
    groups: groupPortalHome({
      customers,
      properties,
      quotes,
      managedCustomerIds: scope.managedCustomerIds,
      today: todaySA(now),
    }),
  };
}
```

Append to `packages/core/src/portal/index.ts`:

```ts
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
```

- [ ] **Step 6: Run, check and commit**

```bash
cd packages/core && npx vitest run src/portal/home.test.ts && cd ../..
npx prettier --write packages/core/src/quotes/acceptance.ts packages/core/src/quotes/outcomes.ts packages/core/src/quotes/public.ts packages/core/src/portal/quotes.ts packages/core/src/portal/home.ts packages/core/src/portal/home.test.ts packages/core/src/portal/portal-quotes.db.test.ts packages/core/src/portal/index.ts
npm run typecheck
npm run lint
npm run test
git add packages/core/src/quotes/acceptance.ts packages/core/src/quotes/outcomes.ts packages/core/src/quotes/public.ts packages/core/src/portal/quotes.ts packages/core/src/portal/home.ts packages/core/src/portal/home.test.ts packages/core/src/portal/portal-quotes.db.test.ts packages/core/src/portal/index.ts
git commit -m "Add portal quotes and My complexes for a scope, with accept and decline through the shared routine

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: all pass. The controller runs `npm run test:db` after this task: the new tests and every existing quote test (acceptance, outcomes, public, portal role) must pass.

---
### Task 9: Portal access: grant after acceptance, staff invite and remove, and the wiring

**Files:**
- Create: `packages/core/src/portal/access.ts`, `packages/core/src/portal/access.db.test.ts`
- Modify: `packages/core/src/customers/contacts.ts` (`removeContact`, `updateContact` end the old email's sign-ins)
- Modify: `packages/core/src/customers/schemas.ts`, `packages/core/src/customers/mappers.ts`, `packages/core/src/customers/schemas.test.ts` (`portalAccess` leaves the contact form)
- Modify: `packages/core/src/quotes/public.ts` (`acceptViaLink` returns the quote id), `packages/core/src/quotes/public.db.test.ts`, `packages/core/src/quotes/portal-role.db.test.ts` (the three `outcome: "ACCEPTED"` expectations)
- Modify: `packages/core/src/portal/index.ts`, `packages/core/src/index.ts`
- Create: `apps/admin/src/lib/portal-access.ts`; Modify: `apps/admin/src/app/(staff)/quotes/actions.ts` (`acceptQuoteAction`)
- Modify: `apps/admin/src/app/(staff)/customers/_components/contact-fields.tsx`, `apps/admin/src/app/(staff)/customers/[id]/contact-form.tsx`, `apps/admin/src/app/(staff)/customers/[id]/contacts-tab.tsx` (remove the portal tick box)
- Create: `apps/portal/src/lib/portal-access.ts`; Modify: `apps/portal/src/app/q/[token]/actions.ts` (`acceptAction`)

**Interfaces:**
- Consumes: `assertRole`, `DomainError`, `MANAGEMENT`, `Actor`; `findEditableCustomer`, `lockCustomer`, `logCustomerEvent`, `logCustomerEventAs`, `Store`, `inTx` (customers); `AuditParty` (`audit.ts`); `EmailMessage`, `sendEmail` (Task 4); `welcomeEmail` (Task 4); `endPortalSignIns` (Task 5); `portalSignInUrl` (Task 3); `getDb`, `getPortalDb`, `inPortalTx`; test helpers (Task 6); `acceptQuote`, `removeContact`, `updateContact`, `archiveCustomer`, `contactSchema`.
- Produces (`portal/access.ts`, all exported from `@ace/core`; `grantPortalAccess` and its types also from `@ace/core/portal`):
  - `PORTAL_ACCESS_MESSAGES = { missing: "That contact could not be found.", noEmail: "Add an email address to this contact before inviting them to the portal.", archived: "Restore this customer before inviting anyone to the portal." } as const`
  - `type PortalInvite = { contactId: string; customerId: string; email: string; name: string }`
  - `type TxRunner = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>`
  - `type InviteDeps = { send: (message: EmailMessage) => Promise<void>; signInUrl: string }`
  - `grantAccessAfterAcceptance(store: Pick<Db, "quote" | "contact" | "customer" | "auditLog">, quoteId: string, now?: Date): Promise<PortalInvite[]>` (call inside a transaction; nothing for a quote that is not ACCEPTED, or an archived or anonymised customer)
  - `sendWelcomeEmails(store: Pick<Db, "auditLog">, invites: readonly PortalInvite[], deps: InviteDeps): Promise<{ sent: number; failed: number }>` (never throws for an email failure)
  - `grantPortalAccess(run: TxRunner, store: Pick<Db, "auditLog">, quoteId: string, deps: InviteDeps): Promise<{ sent: number; failed: number }>`
  - `inviteContact(store: Store, actor: Actor, contactId: string, now?: Date): Promise<PortalInvite>` (owner or manager)
  - `removeContactAccess(store: Store, actor: Actor, contactId: string): Promise<void>` (owner or manager)
- Changes: `LinkAcceptResult`'s ACCEPTED variant becomes `{ outcome: "ACCEPTED"; customerFlag: "PAUSED" | "ARCHIVED" | null; quoteId: string }`. `contactSchema` and `contactData` no longer have `portalAccess`.
- Produces (apps): `grantPortalAccessLater(quoteId: string): void` in `apps/admin/src/lib/portal-access.ts` and in `apps/portal/src/lib/portal-access.ts` (schedules the grant with Next.js `after()`, so it runs after the acceptance has committed and after the response; a failure is logged with fixed words only).

Audit actions (entity type `customer`, ids and fixed words only): `customer.portal_access_granted` `{ contactId, via: "acceptance" }` (actor SYSTEM); `portal.invite_sent` / `portal.invite_failed` `{ contactId }` (actor SYSTEM); `customer.portal_invited` `{ contactId }` (staff); `customer.portal_access_removed` `{ contactId, signInsEnded: boolean }` (staff).

Before writing the Next code, read `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`: `after` works in server actions and still runs when `redirect` is called.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/portal/access.db.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../customers/access";
import { removeContact, updateContact } from "../customers/contacts";
import { archiveCustomer } from "../customers/customers";
import { contactSchema } from "../customers/schemas";
import type { Prisma } from "../generated/prisma/client";
import { acceptQuote } from "../quotes/outcomes";
import { addDays, todaySA } from "../quotes/reference";
import { findQuote } from "../quotes/store";
import { crew, manager } from "../quotes/test-helpers";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import {
  PORTAL_ACCESS_MESSAGES,
  grantAccessAfterAcceptance,
  grantPortalAccess,
  inviteContact,
  removeContactAccess,
  sendWelcomeEmails,
  type TxRunner,
} from "./access";
import type { EmailMessage } from "./email/send";
import { addPortalContact, asPortal, issueFor, makeClient, makeSession } from "./test-helpers";

type Tx = Prisma.TransactionClient;
const SIGN_IN = "https://portal.example.com/sign-in";
const inThisTx = (tx: Tx): TxRunner => (fn) => fn(tx);

function outbox() {
  const sent: EmailMessage[] = [];
  return {
    sent,
    deps: {
      send: async (m: EmailMessage) => {
        sent.push(m);
      },
      signInUrl: SIGN_IN,
    },
  };
}
const failing = {
  send: async () => {
    throw new Error("ZZ mail is down");
  },
  signInUrl: SIGN_IN,
};

const staffAccept = (tx: Tx, quoteId: string) =>
  acceptQuote(tx, manager, quoteId, {
    method: "PHONE",
    acceptedBy: "ZZ Staff Recorded",
    startDate: addDays(todaySA(), 3),
    chosenLineIds: [],
  });

const customerAudit = (tx: Tx, customerId: string, action: string) =>
  tx.auditLog.findMany({ where: { entityType: "customer", entityId: customerId, action } });

describe.skipIf(!dbTestsEnabled)("portal access", () => {
  it("after an acceptance gives access to quote contacts with an email who were never invited, and emails them once", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx, { access: false });
      const noQuotes = await addPortalContact(tx, client.customerId, { access: false, receivesQuotes: false });
      const phoneOnly = await tx.contact.create({
        data: { customerId: client.customerId, name: "ZZ E2E Phone Only", phone: "+27820000001", receivesQuotes: true },
        select: { id: true },
      });
      const earlier = new Date("2026-10-01T08:00:00.000Z");
      const removed = await tx.contact.create({
        data: {
          customerId: client.customerId,
          name: "ZZ E2E Removed",
          email: `${randomUUID()}@example.com`,
          receivesQuotes: true,
          portalAccess: false,
          portalInvitedAt: earlier,
        },
        select: { id: true },
      });
      const q = await issueFor(tx, client);
      // Nothing happens before the quote is accepted.
      expect(await grantAccessAfterAcceptance(tx, q)).toEqual([]);

      await staffAccept(tx, q);
      const box = outbox();
      expect(await grantPortalAccess(inThisTx(tx), tx, q, box.deps)).toEqual({ sent: 1, failed: 0 });
      expect(box.sent).toHaveLength(1);
      expect(box.sent[0]).toMatchObject({ to: client.email, subject: "Welcome to the ACE client portal" });
      expect(box.sent[0]?.text).toContain(SIGN_IN);

      const main = await tx.contact.findUniqueOrThrow({ where: { id: client.contactId } });
      expect(main.portalAccess).toBe(true);
      expect(main.portalInvitedAt).toBeInstanceOf(Date);
      expect((await tx.contact.findUniqueOrThrow({ where: { id: noQuotes.contactId } })).portalAccess).toBe(false);
      expect((await tx.contact.findUniqueOrThrow({ where: { id: phoneOnly.id } })).portalAccess).toBe(false);
      const stillRemoved = await tx.contact.findUniqueOrThrow({ where: { id: removed.id } });
      expect(stillRemoved).toMatchObject({ portalAccess: false, portalInvitedAt: earlier });

      const granted = await customerAudit(tx, client.customerId, "customer.portal_access_granted");
      expect(granted).toHaveLength(1);
      expect(granted[0]).toMatchObject({ actorType: "SYSTEM", actorId: null });
      expect(granted[0]?.after).toEqual({ contactId: client.contactId, via: "acceptance" });
      const sent = await customerAudit(tx, client.customerId, "portal.invite_sent");
      expect(sent).toHaveLength(1);
      expect(sent[0]?.after).toEqual({ contactId: client.contactId });
      const text = JSON.stringify([...granted, ...sent]);
      expect(text).not.toContain(client.email);
      expect(text).not.toContain(main.name);

      // Running it again finds nobody new and sends nothing.
      expect(await grantPortalAccess(inThisTx(tx), tx, q, box.deps)).toEqual({ sent: 0, failed: 0 });
      expect(box.sent).toHaveLength(1);
      expect((await findQuote(tx, q)).status).toBe("ACCEPTED");
    });
  });

  it("notes an email failure without undoing the acceptance or the access, and works as ace_portal", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx, { access: false });
      const q = await issueFor(tx, client);
      await staffAccept(tx, q);
      const invites = await asPortal(tx, () => grantAccessAfterAcceptance(tx, q));
      expect(invites.map((i) => i.contactId)).toEqual([client.contactId]);
      expect(await asPortal(tx, () => sendWelcomeEmails(tx, invites, failing))).toEqual({ sent: 0, failed: 1 });
      expect((await findQuote(tx, q)).status).toBe("ACCEPTED");
      expect((await tx.contact.findUniqueOrThrow({ where: { id: client.contactId } })).portalAccess).toBe(true);
      const failed = await customerAudit(tx, client.customerId, "portal.invite_failed");
      expect(failed).toHaveLength(1);
      expect(failed[0]?.after).toEqual({ contactId: client.contactId });
      expect(JSON.stringify(failed)).not.toContain("ZZ mail is down");
    });
  });

  it("lets staff invite a contact, and refuses crew, a contact with no email and an archived customer", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx, { access: false });
      const name = (await tx.contact.findUniqueOrThrow({ where: { id: client.contactId } })).name;
      expect(await inviteContact(tx, manager, client.contactId)).toEqual({
        contactId: client.contactId,
        customerId: client.customerId,
        email: client.email,
        name,
      });
      const row = await tx.contact.findUniqueOrThrow({ where: { id: client.contactId } });
      expect(row.portalAccess).toBe(true);
      expect(row.portalInvitedAt).toBeInstanceOf(Date);
      const invited = await customerAudit(tx, client.customerId, "customer.portal_invited");
      expect(invited[0]).toMatchObject({ actorType: "STAFF", actorId: manager.id });
      expect(invited[0]?.after).toEqual({ contactId: client.contactId });

      await expect(inviteContact(tx, crew, client.contactId)).rejects.toBeInstanceOf(ForbiddenError);
      const phoneOnly = await tx.contact.create({
        data: { customerId: client.customerId, name: "ZZ E2E Phone Only", phone: "+27820000002" },
        select: { id: true },
      });
      await expect(inviteContact(tx, manager, phoneOnly.id)).rejects.toThrow(PORTAL_ACCESS_MESSAGES.noEmail);
      await expect(inviteContact(tx, manager, randomUUID())).rejects.toThrow(PORTAL_ACCESS_MESSAGES.missing);
      const other = await makeClient(tx, { access: false });
      await archiveCustomer(tx, manager, other.customerId);
      await expect(inviteContact(tx, manager, other.contactId)).rejects.toThrow(PORTAL_ACCESS_MESSAGES.archived);

      // Staff may deliberately invite a removed person again.
      await removeContactAccess(tx, manager, client.contactId);
      await inviteContact(tx, manager, client.contactId);
      expect((await tx.contact.findUniqueOrThrow({ where: { id: client.contactId } })).portalAccess).toBe(true);
    });
  });

  it("ends an email's sign-ins on removal only when no other contact with it has access, and never re-grants it", async () => {
    await withRollback(async (tx) => {
      const email = `${randomUUID()}@example.com`;
      const a = await makeClient(tx, { email });
      const b = await makeClient(tx, { email });
      await makeSession(tx, email);
      await tx.portalCode.create({
        data: { email, codeHash: "0".repeat(64), salt: "0".repeat(32), expiresAt: new Date(Date.now() + 600_000) },
      });
      await expect(removeContactAccess(tx, crew, a.contactId)).rejects.toBeInstanceOf(ForbiddenError);

      await removeContactAccess(tx, manager, a.contactId);
      const rowA = await tx.contact.findUniqueOrThrow({ where: { id: a.contactId } });
      expect(rowA.portalAccess).toBe(false);
      expect(rowA.portalInvitedAt).toBeInstanceOf(Date);
      expect(await tx.portalSession.count({ where: { email } })).toBe(1);
      expect((await customerAudit(tx, a.customerId, "customer.portal_access_removed"))[0]?.after).toEqual({
        contactId: a.contactId,
        signInsEnded: false,
      });

      await removeContactAccess(tx, manager, b.contactId);
      expect(await tx.portalSession.count({ where: { email } })).toBe(0);
      expect(await tx.portalCode.count({ where: { email } })).toBe(0);
      expect((await customerAudit(tx, b.customerId, "customer.portal_access_removed"))[0]?.after).toEqual({
        contactId: b.contactId,
        signInsEnded: true,
      });

      // A later acceptance does not give access back to someone who was removed.
      const q = await issueFor(tx, a);
      await staffAccept(tx, q);
      const box = outbox();
      expect(await grantPortalAccess(inThisTx(tx), tx, q, box.deps)).toEqual({ sent: 0, failed: 0 });
      expect((await tx.contact.findUniqueOrThrow({ where: { id: a.contactId } })).portalAccess).toBe(false);
    });
  });

  it("ends the old email's sign-ins when a contact is removed or changes email", async () => {
    await withRollback(async (tx) => {
      const client = await makeClient(tx);
      const extra = await addPortalContact(tx, client.customerId);
      await makeSession(tx, extra.email);
      await removeContact(tx, manager, extra.contactId);
      expect(await tx.portalSession.count({ where: { email: extra.email } })).toBe(0);

      await makeSession(tx, client.email);
      const newEmail = `${randomUUID()}@example.com`;
      await updateContact(
        tx,
        manager,
        client.contactId,
        contactSchema.parse({ name: "ZZ E2E Renamed", email: newEmail, receivesQuotes: "on" }),
      );
      expect(await tx.portalSession.count({ where: { email: client.email } })).toBe(0);

      // A change that keeps the email keeps the sign-ins.
      await makeSession(tx, newEmail);
      await updateContact(
        tx,
        manager,
        client.contactId,
        contactSchema.parse({ name: "ZZ E2E Renamed Again", email: newEmail, receivesQuotes: "on" }),
      );
      expect(await tx.portalSession.count({ where: { email: newEmail } })).toBe(1);
    });
  });
});
```

In `packages/core/src/customers/schemas.test.ts`, replace the test `"rejects a bad phone and portal access without an email"` with:

```ts
  it("rejects a bad phone", () => {
    expect(contactSchema.safeParse({ name: "Sam", phone: "12" }).success).toBe(false);
  });
  it("no longer carries portal access (staff change it with Invite and Remove)", () => {
    const parsed = contactSchema.parse({ name: "Sam", phone: "0821234567", portalAccess: "on" });
    expect("portalAccess" in parsed).toBe(false);
  });
```

Update the three expectations of a link acceptance:
- `packages/core/src/quotes/public.db.test.ts`: `expect(result).toEqual({ outcome: "ACCEPTED", customerFlag: null });` (the test that uses `const { id } = await createQuote(...)`) becomes `expect(result).toEqual({ outcome: "ACCEPTED", customerFlag: null, quoteId: id });`, and `expect(result).toEqual({ outcome: "ACCEPTED", customerFlag: "PAUSED" });` becomes `expect(result).toEqual({ outcome: "ACCEPTED", customerFlag: "PAUSED", quoteId: q.id });`.
- `packages/core/src/quotes/portal-role.db.test.ts`: `expect(result).toEqual({ outcome: "ACCEPTED", customerFlag: null });` becomes `expect(result).toEqual({ outcome: "ACCEPTED", customerFlag: null, quoteId: q.id });`.

Run `cd packages/core && npx vitest run src/customers/schemas.test.ts && cd ../..`: expect FAIL (the new schema test: `portalAccess` is still parsed).

- [ ] **Step 2: Contact form: no portal tick box**

`packages/core/src/customers/schemas.ts`: in `contactSchema`, delete the line `portalAccess: checkbox,` and delete the second `.refine(...)` (the one with the message `Portal access needs an email address.`).

`packages/core/src/customers/mappers.ts`: in `contactData`, delete the line `portalAccess: c.portalAccess,`.

`apps/admin/src/app/(staff)/customers/_components/contact-fields.tsx`: delete the whole `<CheckboxField label="Can use the client portal" ... />` element (the third tick box).

`apps/admin/src/app/(staff)/customers/[id]/contact-form.tsx`: delete `portalAccess: boolean;` from `ContactRow` and the line `if (c.portalAccess) v.portalAccess = "on";`.

`apps/admin/src/app/(staff)/customers/[id]/contacts-tab.tsx`: in `toRow`, delete `portalAccess: c.portalAccess,` (the "portal" word in the list line stays; it reads the full contact).

- [ ] **Step 3: Write `packages/core/src/portal/access.ts`**

```ts
import type { AuditParty } from "../audit";
import { assertRole, DomainError, MANAGEMENT, type Actor } from "../customers/access";
import {
  findEditableCustomer,
  lockCustomer,
  logCustomerEvent,
  logCustomerEventAs,
  type Store,
} from "../customers/store";
import type { Db } from "../db";
import type { Prisma } from "../generated/prisma/client";
import type { EmailMessage } from "./email/send";
import { welcomeEmail } from "./email/templates";
import { endPortalSignIns } from "./end-sign-ins";

const SYSTEM: AuditParty = { actorType: "SYSTEM" };

export const PORTAL_ACCESS_MESSAGES = {
  missing: "That contact could not be found.",
  noEmail: "Add an email address to this contact before inviting them to the portal.",
  archived: "Restore this customer before inviting anyone to the portal.",
} as const;

/** Someone who has just been given access and should get the welcome email. Server-side only. */
export type PortalInvite = { contactId: string; customerId: string; email: string; name: string };

export type TxRunner = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

export type InviteDeps = { send: (message: EmailMessage) => Promise<void>; signInUrl: string };

/**
 * After an acceptance has committed: the quote customer's contacts with an email, who receive quotes, have
 * no access and were never invited, get access and an invitation date. A contact whose access was removed
 * keeps its invitation date, so it is never silently given access again. Lock: the customer. Call inside
 * a transaction. Works under the `ace_portal` role (it names only granted columns).
 */
export async function grantAccessAfterAcceptance(
  store: Pick<Db, "quote" | "contact" | "customer" | "auditLog">,
  quoteId: string,
  now: Date = new Date(),
): Promise<PortalInvite[]> {
  const quote = await store.quote.findUnique({
    where: { id: quoteId },
    select: { customerId: true, status: true },
  });
  if (!quote || quote.status !== "ACCEPTED") return [];
  const candidates = {
    customerId: quote.customerId,
    email: { not: null },
    receivesQuotes: true,
    portalAccess: false,
    portalInvitedAt: null,
  } satisfies Prisma.ContactWhereInput;
  if ((await store.contact.count({ where: candidates })) === 0) return [];
  const customer = await store.customer.findUnique({
    where: { id: quote.customerId },
    select: { status: true, anonymisedAt: true },
  });
  // An archived or anonymised customer is outside every portal scope: access would be pointless.
  if (!customer || customer.anonymisedAt || customer.status === "ARCHIVED") return [];
  await lockCustomer(store, quote.customerId);
  const contacts = await store.contact.findMany({
    where: candidates,
    orderBy: { id: "asc" },
    select: { id: true, name: true, email: true },
  });
  const invites: PortalInvite[] = [];
  for (const c of contacts) {
    if (!c.email) continue;
    const { count } = await store.contact.updateMany({
      where: { id: c.id, portalAccess: false, portalInvitedAt: null },
      data: { portalAccess: true, portalInvitedAt: now },
    });
    if (count !== 1) continue;
    invites.push({ contactId: c.id, customerId: quote.customerId, email: c.email, name: c.name });
    await logCustomerEventAs(store, SYSTEM, "customer.portal_access_granted", quote.customerId, {
      contactId: c.id,
      via: "acceptance",
    });
  }
  return invites;
}

/**
 * Sends the welcome email to each invite and notes the result in the audit log with fixed words only.
 * An email failure never throws: staff can press Invite to portal to send it again.
 */
export async function sendWelcomeEmails(
  store: Pick<Db, "auditLog">,
  invites: readonly PortalInvite[],
  deps: InviteDeps,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const invite of invites) {
    let ok = true;
    try {
      await deps.send(welcomeEmail({ to: invite.email, name: invite.name, signInUrl: deps.signInUrl }));
    } catch {
      ok = false;
    }
    if (ok) sent += 1;
    else failed += 1;
    await logCustomerEventAs(
      store,
      SYSTEM,
      ok ? "portal.invite_sent" : "portal.invite_failed",
      invite.customerId,
      { contactId: invite.contactId },
    );
  }
  return { sent, failed };
}

/**
 * The whole step after an acceptance commits: the grant in its own transaction (`run`), then the emails.
 * Called by the staff accept, the link accept and the portal accept, at the application layer.
 */
export async function grantPortalAccess(
  run: TxRunner,
  store: Pick<Db, "auditLog">,
  quoteId: string,
  deps: InviteDeps,
): Promise<{ sent: number; failed: number }> {
  const invites = await run((tx) => grantAccessAfterAcceptance(tx, quoteId));
  return sendWelcomeEmails(store, invites, deps);
}

async function readContact(store: Store, contactId: string) {
  const c = await store.contact.findUnique({
    where: { id: contactId },
    select: { id: true, customerId: true, name: true, email: true, portalAccess: true },
  });
  if (!c) throw new DomainError(PORTAL_ACCESS_MESSAGES.missing);
  return c;
}

/**
 * Staff "Invite to portal": gives access (again) and returns the invite so the caller can send the welcome
 * after the transaction commits. Owner or manager. Lock: the customer.
 */
export async function inviteContact(
  store: Store,
  actor: Actor,
  contactId: string,
  now: Date = new Date(),
): Promise<PortalInvite> {
  assertRole(actor, MANAGEMENT);
  const check = async () => {
    const c = await readContact(store, contactId);
    const email = c.email;
    if (!email) throw new DomainError(PORTAL_ACCESS_MESSAGES.noEmail);
    const customer = await findEditableCustomer(store, c.customerId);
    if (customer.status === "ARCHIVED") throw new DomainError(PORTAL_ACCESS_MESSAGES.archived);
    return { ...c, email };
  };
  const first = await check();
  await lockCustomer(store, first.customerId);
  const c = await check();
  await store.contact.update({
    where: { id: c.id },
    data: { portalAccess: true, portalInvitedAt: now },
    select: { id: true },
  });
  await logCustomerEvent(store, actor, "customer.portal_invited", c.customerId, { contactId: c.id });
  return { contactId: c.id, customerId: c.customerId, email: c.email, name: c.name };
}

/**
 * Staff "Remove access": access off (the invitation date is kept), and that email's sessions and codes are
 * deleted unless another contact with the same email still has access. Owner or manager. Lock: the customer.
 */
export async function removeContactAccess(store: Store, actor: Actor, contactId: string): Promise<void> {
  assertRole(actor, MANAGEMENT);
  const first = await readContact(store, contactId);
  if (!first.portalAccess) return;
  await findEditableCustomer(store, first.customerId);
  await lockCustomer(store, first.customerId);
  const c = await readContact(store, contactId);
  if (!c.portalAccess) return;
  await store.contact.update({
    where: { id: c.id },
    data: { portalAccess: false },
    select: { id: true },
  });
  const ended = c.email ? await endPortalSignIns(store, [c.email], [c.id]) : 0;
  await logCustomerEvent(store, actor, "customer.portal_access_removed", c.customerId, {
    contactId: c.id,
    signInsEnded: ended > 0,
  });
}
```

- [ ] **Step 4: End old sign-ins in `packages/core/src/customers/contacts.ts`**

Add `import { endPortalSignIns } from "../portal/end-sign-ins";`.

In `updateContact`, after `await store.contact.update({ where: { id: contactId }, data });` add:

```ts
  // The old email's portal sign-ins end (unless another contact with it still has access).
  if (existing.email && existing.email !== data.email) {
    await endPortalSignIns(store, [existing.email], [contactId]);
  }
```

In `removeContact`, after `await store.contact.delete({ where: { id: contactId } });` add:

```ts
  if (existing.email) await endPortalSignIns(store, [existing.email], [contactId]);
```

- [ ] **Step 5: The link acceptance returns the quote id** (`packages/core/src/quotes/public.ts`)

Change the first member of `LinkAcceptResult` to `| { outcome: "ACCEPTED"; customerFlag: "PAUSED" | "ARCHIVED" | null; quoteId: string }` and, in `acceptViaLink`, `return { outcome: "ACCEPTED", customerFlag };` to `return { outcome: "ACCEPTED", customerFlag, quoteId: found.id };`.

- [ ] **Step 6: Exports**

Append to `packages/core/src/portal/index.ts`:

```ts
export { grantPortalAccess, type InviteDeps, type TxRunner } from "./access";
```

Add to `packages/core/src/index.ts`:

```ts
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
```

(`grantAccessAfterAcceptance` stays out of both barrels; `grantPortalAccess` is the only entry.)

- [ ] **Step 7: Wire the grant into the three acceptance paths**

`apps/admin/src/lib/portal-access.ts`:

```ts
import "server-only";
import { getDb, grantPortalAccess, inTx, portalSignInUrl, sendEmail } from "@ace/core";
import { after } from "next/server";

/**
 * After an acceptance has committed: gives the customer's quote contacts portal access and emails them the
 * welcome. Runs after the response, in its own transaction. A failure is logged with fixed words only and
 * never touches the acceptance (staff can press Invite to portal on the contact).
 */
export function grantPortalAccessLater(quoteId: string): void {
  after(async () => {
    try {
      await grantPortalAccess(inTx, getDb(), quoteId, {
        send: (message) => sendEmail(message),
        signInUrl: portalSignInUrl(),
      });
    } catch {
      console.error("Portal access could not be given after an acceptance.");
    }
  });
}
```

`apps/admin/src/app/(staff)/quotes/actions.ts`: add `import { grantPortalAccessLater } from "@/lib/portal-access";` and in `acceptQuoteAction` insert `grantPortalAccessLater(id.data);` on the line after the `try { ... } catch { ... }` block, before the final `redirect(...)`.

`apps/portal/src/lib/portal-access.ts`:

```ts
import "server-only";
import { getPortalDb, grantPortalAccess, inPortalTx, portalSignInUrl, sendEmail } from "@ace/core";
import { after } from "next/server";

/**
 * After a client acceptance (link or portal) has committed: gives the customer's quote contacts portal
 * access and emails them the welcome, after the response, through the portal's own database login.
 * A failure is logged with fixed words only and never touches the acceptance.
 */
export function grantPortalAccessLater(quoteId: string): void {
  after(async () => {
    try {
      await grantPortalAccess(inPortalTx, getPortalDb(), quoteId, {
        send: (message) => sendEmail(message),
        signInUrl: portalSignInUrl(),
      });
    } catch {
      console.error("Portal access could not be given after an acceptance.");
    }
  });
}
```

`apps/portal/src/app/q/[token]/actions.ts`: add `import { grantPortalAccessLater } from "@/lib/portal-access";` and, in `acceptAction`, replace

```ts
  try {
    await inPortalTx((tx) =>
      acceptViaLink(tx, token, parsed.data, {
        ip: guarded.visitor.ip,
        userAgent: guarded.visitor.userAgent,
      }),
    );
  } catch (error) {
```

with

```ts
  let result: Awaited<ReturnType<typeof acceptViaLink>>;
  try {
    result = await inPortalTx((tx) =>
      acceptViaLink(tx, token, parsed.data, {
        ip: guarded.visitor.ip,
        userAgent: guarded.visitor.userAgent,
      }),
    );
  } catch (error) {
```

and insert `if (result.outcome === "ACCEPTED") grantPortalAccessLater(result.quoteId);` directly before `return backToPage(token);` at the end of `acceptAction`.

- [ ] **Step 8: Run, check and commit**

```bash
cd packages/core && npx vitest run src/customers && cd ../..
npx prettier --write packages/core/src/portal/access.ts packages/core/src/portal/access.db.test.ts packages/core/src/customers/contacts.ts packages/core/src/customers/schemas.ts packages/core/src/customers/mappers.ts packages/core/src/customers/schemas.test.ts packages/core/src/quotes/public.ts packages/core/src/quotes/public.db.test.ts packages/core/src/quotes/portal-role.db.test.ts packages/core/src/portal/index.ts packages/core/src/index.ts apps/admin/src/lib/portal-access.ts "apps/admin/src/app/(staff)/quotes/actions.ts" "apps/admin/src/app/(staff)/customers/_components/contact-fields.tsx" "apps/admin/src/app/(staff)/customers/[id]/contact-form.tsx" "apps/admin/src/app/(staff)/customers/[id]/contacts-tab.tsx" apps/portal/src/lib/portal-access.ts "apps/portal/src/app/q/[token]/actions.ts"
npm run typecheck
npm run lint
npm run test
git add packages/core/src/portal/access.ts packages/core/src/portal/access.db.test.ts packages/core/src/customers/contacts.ts packages/core/src/customers/schemas.ts packages/core/src/customers/mappers.ts packages/core/src/customers/schemas.test.ts packages/core/src/quotes/public.ts packages/core/src/quotes/public.db.test.ts packages/core/src/quotes/portal-role.db.test.ts packages/core/src/portal/index.ts packages/core/src/index.ts apps/admin/src/lib/portal-access.ts "apps/admin/src/app/(staff)/quotes/actions.ts" "apps/admin/src/app/(staff)/customers/_components/contact-fields.tsx" "apps/admin/src/app/(staff)/customers/[id]/contact-form.tsx" "apps/admin/src/app/(staff)/customers/[id]/contacts-tab.tsx" apps/portal/src/lib/portal-access.ts "apps/portal/src/app/q/[token]/actions.ts"
git commit -m "Grant portal access after an acceptance, add staff invite and remove, and end old sign-ins

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: all pass. The controller runs `npm run test:db` after this task.

---
### Task 10: Portal app infrastructure: headers, session helpers, shared forms, sign out

**Files:**
- Modify: `packages/core/src/portal/cookies.ts`, `packages/core/src/portal/cookies.test.ts`, `packages/core/src/portal/index.ts` (`portalCookieOptions`)
- Modify: `apps/portal/next.config.ts`
- Create: `apps/portal/src/lib/session.ts`, `apps/portal/src/lib/form.ts`, `apps/portal/src/lib/form-state.ts`
- Create: `apps/portal/src/components/notices.tsx` (moved from `src/app/q/[token]/notices.tsx`), `apps/portal/src/components/form-classes.ts` (moved from `src/app/q/[token]/form-classes.ts`), `apps/portal/src/components/quote-forms/accept-form.tsx`, `apps/portal/src/components/quote-forms/decline-form.tsx` (moved, now take the action as a prop), `apps/portal/src/components/signed-in-shell.tsx`
- Create: `apps/portal/src/app/actions.ts` (sign out)
- Modify: `apps/portal/src/app/q/[token]/page.tsx`, `apps/portal/src/app/q/[token]/actions.ts`
- Delete: `apps/portal/src/app/q/[token]/accept-form.tsx`, `decline-form.tsx`, `form-classes.ts`, `form-state.ts`, `notices.tsx`

**Interfaces:**
- Consumes: `getPortalDb`, `checkRateLimit`, `linkAcceptSchema`, `LinkAcceptInput`, `acceptViaLink`, `declineViaLink`, `linkDeclineSchema`, `inPortalTx`, `DomainError` (`@ace/core`); `getPortalSession`, `signOut`, `needsWelcome`, `normaliseEmail`, `portalCookieNames`, `PENDING_EMAIL_MAX_AGE_SECONDS`, `PortalSession` (`@ace/core/portal`); `getVisitor`, `Visitor` (`apps/portal/src/lib/visitor.ts`); `grantPortalAccessLater` (Task 9).
- Produces (core): `type PortalCookieOptions = { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/" }`; `portalCookieOptions(nodeEnv?: string): PortalCookieOptions` (secure only in production).
- Produces (portal app):
  - `src/lib/form-state.ts`: `type FormState` (same shape as before: `error?`, `fieldErrors?`, `values?`, `nonce?`, or undefined).
  - `src/lib/form.ts` (server only): `TRY_AGAIN`, `BAD_REQUEST`; `formValues(formData: FormData): Record<string, string>`; `errorsFrom(error: z.ZodError): Record<string, string>`; `guardAction(values: Record<string, string>): Promise<{ visitor: Visitor } | { refused: FormState }>` (refuses bots, counts against the visitor's `act` allowance); `acceptFormValues(formData: FormData): Record<string, string>`; `parseAcceptForm(formData: FormData, values: Record<string, string>): { data: LinkAcceptInput } | { state: FormState }`.
  - `src/lib/session.ts` (server only): `getSession(): Promise<PortalSession | null>`; `requireSession(opts?: { allowUnwelcomed?: boolean }): Promise<PortalSession>` (redirects to `/sign-in`, or to `/welcome` while a contact is not welcomed); `readSessionToken(): Promise<string | undefined>`; `setSessionCookie(token: string, expires: Date): Promise<void>`; `clearSessionCookie(): Promise<void>`; `setPendingEmail(email: string): Promise<void>`; `readPendingEmail(): Promise<string | null>`; `clearPendingEmail(): Promise<void>`. The setters and clearers work only in server actions and route handlers.
  - `src/components/quote-forms/accept-form.tsx`: `type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>`; `AcceptForm({ action, reference, optionalLines, today }: { action: FormAction; reference: string; optionalLines: { id: string; label: string }[]; today: string })`.
  - `src/components/quote-forms/decline-form.tsx`: `DeclineForm({ action }: { action: FormAction })`.
  - `src/components/notices.tsx`: `PageShell`, `Notice`, `Contact`, `BarePage`, `TooManyRequests` (unchanged).
  - `src/components/form-classes.ts`: `fieldClass`, `primaryButtonClass` (unchanged), new `secondaryButtonClass`.
  - `src/components/signed-in-shell.tsx`: `SignedInShell({ children })` (page frame with the ACE name linking home and a Sign out button).
  - `src/app/actions.ts`: `signOutAction(): Promise<void>`.

Before writing Next code read `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md` (setting and deleting cookies only in server actions and route handlers) and `.../05-config/01-next-config-js/headers.md`. The shared forms are client components; they import only types from core. A bound server action (`acceptAction.bind(null, token)`) may be passed from a server component to a client component as a prop; event handlers may not.

- [ ] **Step 1: Write the failing test** (append to `packages/core/src/portal/cookies.test.ts`)

```ts
import { portalCookieOptions } from "./cookies";

describe("portal cookie options", () => {
  it("are HTTP-only, same-site lax, path / always, and secure in production", () => {
    expect(portalCookieOptions("production")).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    expect(portalCookieOptions("development")).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    });
  });
});
```

(Merge the import into the existing import line from `./cookies`.) Run `cd packages/core && npx vitest run src/portal/cookies.test.ts && cd ../..`: expect FAIL (`portalCookieOptions` missing).

- [ ] **Step 2: The core helper**

Append to `packages/core/src/portal/cookies.ts`:

```ts
export type PortalCookieOptions = { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/" };

/** Every portal cookie: never readable by page scripts, sent on top-level navigation, whole site. */
export function portalCookieOptions(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): PortalCookieOptions {
  return { httpOnly: true, secure: nodeEnv === "production", sameSite: "lax", path: "/" };
}
```

In `packages/core/src/portal/index.ts`, change the cookies export line to:

```ts
export {
  PENDING_EMAIL_MAX_AGE_SECONDS,
  portalCookieNames,
  portalCookieOptions,
  type PortalCookieNames,
  type PortalCookieOptions,
} from "./cookies";
```

Run the test again: PASS.

- [ ] **Step 3: Headers** (`apps/portal/next.config.ts`)

Add below `privateLinkHeaders`:

```ts
// Signed-in pages and the sign-in pages: never cached, never indexed. Static assets are not matched.
const signedInHeaders = [
  { key: "Cache-Control", value: "private, no-store" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];
```

and replace the array returned by `headers()` with:

```ts
    return [
      { source: "/(.*)", headers: securityHeaders },
      { source: "/", headers: signedInHeaders },
      { source: "/welcome", headers: signedInHeaders },
      { source: "/sign-in", headers: signedInHeaders },
      { source: "/sign-in/:path*", headers: signedInHeaders },
      { source: "/quotes/:path*", headers: signedInHeaders },
      // Listed last: when two rules set the same header, the later one wins (Referrer-Policy).
      { source: "/q/:path*", headers: privateLinkHeaders },
    ];
```

- [ ] **Step 4: Form state and form helpers**

`apps/portal/src/lib/form-state.ts`:

```ts
export type FormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      /** What was typed, so a refused form does not wipe it. `chosen` is a comma-separated list of ids. */
      values?: Record<string, string>;
      /** Changes on every response so the form remounts with `values`. */
      nonce?: number;
    }
  | undefined;
```

`apps/portal/src/lib/form.ts`:

```ts
import "server-only";
import { checkRateLimit, getPortalDb, linkAcceptSchema, type LinkAcceptInput } from "@ace/core";
import { z } from "zod";
import type { FormState } from "@/lib/form-state";
import { getVisitor, type Visitor } from "@/lib/visitor";

export const TRY_AGAIN = "Too many attempts. Please wait ten minutes and try again.";
export const BAD_REQUEST = "Something went wrong. Refresh the page and try again.";

export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export function errorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, messages] of Object.entries(z.flattenError(error).fieldErrors)) {
    const message = (messages as string[] | undefined)?.[0];
    if (message) out[field] = message;
  }
  return out;
}

/**
 * Counts the attempt against the visitor's allowance. Refuses crawlers and clients with no browser string.
 * A refusal hands back what was typed, so the form does not wipe it.
 */
export async function guardAction(
  values: Record<string, string>,
): Promise<{ visitor: Visitor } | { refused: FormState }> {
  const visitor = await getVisitor();
  if (visitor.isBot) return { refused: { error: BAD_REQUEST, values, nonce: Date.now() } };
  if (!(await checkRateLimit(getPortalDb(), "act", visitor.ipHash)).allowed) {
    return { refused: { error: TRY_AGAIN, values, nonce: Date.now() } };
  }
  return { visitor };
}

/** The accept form's values, with the ticked add-ons as one comma-separated `chosen` entry. */
export function acceptFormValues(formData: FormData): Record<string, string> {
  const chosen = formData.getAll("chosen").filter((v): v is string => typeof v === "string");
  return { ...formValues(formData), chosen: chosen.join(",") };
}

/** Checks the accept form (the agree tick, then the shared schema). Used by the link and the portal. */
export function parseAcceptForm(
  formData: FormData,
  values: Record<string, string>,
): { data: LinkAcceptInput } | { state: FormState } {
  if (formData.get("agree") !== "on") {
    return {
      state: { fieldErrors: { agree: "Tick the box to accept this quotation." }, values, nonce: Date.now() },
    };
  }
  const chosen = formData.getAll("chosen").filter((v): v is string => typeof v === "string");
  const parsed = linkAcceptSchema.safeParse({
    acceptedBy: values.acceptedBy ?? "",
    startDate: values.startDate ?? "",
    chosenLineIds: chosen,
  });
  if (!parsed.success) {
    const fieldErrors = errorsFrom(parsed.error);
    // An error on a field the form does not show (a crafted request) would otherwise be invisible.
    const hidden = Object.keys(fieldErrors).some((k) => k !== "acceptedBy" && k !== "startDate");
    return {
      state: { fieldErrors, ...(hidden ? { error: BAD_REQUEST } : {}), values, nonce: Date.now() },
    };
  }
  return { data: parsed.data };
}
```

- [ ] **Step 5: Session helpers** (`apps/portal/src/lib/session.ts`)

```ts
import "server-only";
import { getPortalDb } from "@ace/core";
import {
  PENDING_EMAIL_MAX_AGE_SECONDS,
  getPortalSession,
  needsWelcome,
  normaliseEmail,
  portalCookieNames,
  portalCookieOptions,
  type PortalSession,
} from "@ace/core/portal";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const names = () => portalCookieNames(process.env.NODE_ENV);
const options = () => portalCookieOptions(process.env.NODE_ENV);

/** The cookie value (the raw session token), if any. */
export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(names().session)?.value;
}

/** The signed-in person, or null. Works in pages, actions and routes. */
export async function getSession(): Promise<PortalSession | null> {
  return getPortalSession(getPortalDb(), await readSessionToken());
}

/**
 * EVERY signed-in page and action calls this first. Not signed in: to /sign-in. A contact not yet welcomed:
 * to /welcome (the welcome page itself passes `allowUnwelcomed`).
 */
export async function requireSession(opts: { allowUnwelcomed?: boolean } = {}): Promise<PortalSession> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!opts.allowUnwelcomed && needsWelcome(session.scope)) redirect("/welcome");
  return session;
}

/** Server actions and route handlers only. The cookie lasts until the session's absolute end. */
export async function setSessionCookie(token: string, expires: Date): Promise<void> {
  (await cookies()).set(names().session, token, { ...options(), expires });
}

/** Server actions and route handlers only. Overwrites with an expired cookie (keeps the __Host- rules). */
export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(names().session, "", { ...options(), maxAge: 0 });
}

/** The typed email between the two sign-in pages, never in the address bar. */
export async function setPendingEmail(email: string): Promise<void> {
  (await cookies()).set(names().pendingEmail, email, {
    ...options(),
    maxAge: PENDING_EMAIL_MAX_AGE_SECONDS,
  });
}

export async function readPendingEmail(): Promise<string | null> {
  const value = (await cookies()).get(names().pendingEmail)?.value;
  return value ? normaliseEmail(value) : null;
}

export async function clearPendingEmail(): Promise<void> {
  (await cookies()).set(names().pendingEmail, "", { ...options(), maxAge: 0 });
}
```

- [ ] **Step 6: Move the shared pieces into `src/components`**

Move with git so history follows:

```bash
mkdir -p apps/portal/src/components/quote-forms
git mv "apps/portal/src/app/q/[token]/notices.tsx" apps/portal/src/components/notices.tsx
git mv "apps/portal/src/app/q/[token]/form-classes.ts" apps/portal/src/components/form-classes.ts
git mv "apps/portal/src/app/q/[token]/accept-form.tsx" apps/portal/src/components/quote-forms/accept-form.tsx
git mv "apps/portal/src/app/q/[token]/decline-form.tsx" apps/portal/src/components/quote-forms/decline-form.tsx
git rm "apps/portal/src/app/q/[token]/form-state.ts"
```

`apps/portal/src/components/form-classes.ts`: append

```ts
export const secondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full px-5 py-2 font-display text-sm font-semibold text-forest ring-1 ring-forest/30 hover:bg-forest hover:text-cream";
```

`apps/portal/src/components/quote-forms/accept-form.tsx`: change the top of the file (everything above `return (`) to:

```tsx
"use client";

import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { useActionState, useRef } from "react";
import { fieldClass, primaryButtonClass } from "@/components/form-classes";
import type { FormState } from "@/lib/form-state";

/** A server action already bound to its quote (by link code or by id). */
export type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>;

type Props = {
  action: FormAction;
  reference: string;
  optionalLines: { id: string; label: string }[];
  /** Today in South African time, as YYYY-MM-DD: the earliest start date. */
  today: string;
};

/** The accept form, shared by the private link page and the portal quote page. */
export function AcceptForm({ action: submit, reference, optionalLines, today }: Props) {
  const [state, action, pending] = useActionState(submit, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  const e = state?.fieldErrors ?? {};
  const v = state?.values ?? {};
  const chosen = new Set((v.chosen ?? "").split(",").filter(Boolean));
```

(the JSX below stays exactly as it is).

`apps/portal/src/components/quote-forms/decline-form.tsx`: change the top of the file (everything above `return (`) to:

```tsx
"use client";

import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { useActionState, useRef } from "react";
import { fieldClass } from "@/components/form-classes";
import type { FormAction } from "./accept-form";

/** The decline form, shared by the private link page and the portal quote page. */
export function DeclineForm({ action: submit }: { action: FormAction }) {
  const [state, action, pending] = useActionState(submit, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
```

(the JSX below stays exactly as it is).

- [ ] **Step 7: The link page and actions use the shared pieces**

`apps/portal/src/app/q/[token]/page.tsx`: replace the three local imports (`./accept-form`, `./decline-form`, `./notices`) with:

```tsx
import { BarePage, Contact, Notice, PageShell, TooManyRequests } from "@/components/notices";
import { AcceptForm } from "@/components/quote-forms/accept-form";
import { DeclineForm } from "@/components/quote-forms/decline-form";
import { acceptAction, declineAction } from "./actions";
```

and in the `OPEN` case replace the two form elements with:

```tsx
          <AcceptForm
            action={acceptAction.bind(null, token)}
            reference={quote.reference}
            optionalLines={quote.optionalLines}
            today={todaySA()}
          />
          <DeclineForm action={declineAction.bind(null, token)} />
```

Replace `apps/portal/src/app/q/[token]/actions.ts` with:

```ts
"use server";

import {
  DomainError,
  acceptViaLink,
  declineViaLink,
  inPortalTx,
  linkDeclineSchema,
} from "@ace/core";
import { redirect } from "next/navigation";
import {
  acceptFormValues,
  errorsFrom,
  formValues,
  guardAction,
  parseAcceptForm,
} from "@/lib/form";
import type { FormState } from "@/lib/form-state";
import { grantPortalAccessLater } from "@/lib/portal-access";

/**
 * Every outcome except a typing mistake goes back to the page, which then shows the true state (accepted,
 * expired, withdrawn, not found...). This also makes a double tap harmless.
 */
const backToPage = (token: string): never => redirect(`/q/${encodeURIComponent(token)}`);

export async function acceptAction(
  token: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = acceptFormValues(formData);
  const guarded = await guardAction(values);
  if ("refused" in guarded) return guarded.refused;
  const parsed = parseAcceptForm(formData, values);
  if ("state" in parsed) return parsed.state;
  let result: Awaited<ReturnType<typeof acceptViaLink>>;
  try {
    result = await inPortalTx((tx) =>
      acceptViaLink(tx, token, parsed.data, {
        ip: guarded.visitor.ip,
        userAgent: guarded.visitor.userAgent,
      }),
    );
  } catch (error) {
    // Plain refusals (a start date in the past, a line that is not an add-on) are shown with the form.
    if (error instanceof DomainError) return { error: error.message, values, nonce: Date.now() };
    throw error;
  }
  if (result.outcome === "ACCEPTED") grantPortalAccessLater(result.quoteId);
  return backToPage(token);
}

export async function declineAction(
  token: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData);
  const guarded = await guardAction(values);
  if ("refused" in guarded) return guarded.refused;
  const parsed = linkDeclineSchema.safeParse({ reason: values.reason ?? "" });
  if (!parsed.success) return { fieldErrors: errorsFrom(parsed.error), values, nonce: Date.now() };
  try {
    await inPortalTx((tx) =>
      declineViaLink(tx, token, parsed.data, {
        ip: guarded.visitor.ip,
        userAgent: guarded.visitor.userAgent,
      }),
    );
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, values, nonce: Date.now() };
    throw error;
  }
  return backToPage(token);
}
```

- [ ] **Step 8: Sign out and the signed-in frame**

`apps/portal/src/app/actions.ts`:

```ts
"use server";

import { getPortalDb } from "@ace/core";
import { signOut } from "@ace/core/portal";
import { redirect } from "next/navigation";
import { clearSessionCookie, readSessionToken } from "@/lib/session";

/** Deletes the session row and the cookie, then goes to the sign-in page. */
export async function signOutAction(): Promise<void> {
  await signOut(getPortalDb(), await readSessionToken());
  await clearSessionCookie();
  redirect("/sign-in");
}
```

`apps/portal/src/components/signed-in-shell.tsx` (a server component: the form posts to a server action, no event handlers):

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/actions";

export function SignedInShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          prefetch={false}
          className="inline-flex min-h-10 items-center text-xs font-semibold tracking-[0.18em] text-ochre uppercase"
        >
          ACE Garden Services
        </Link>
        <form action={signOutAction}>
          <button
            type="submit"
            className="inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold text-forest ring-1 ring-forest/30 hover:bg-forest hover:text-cream"
          >
            Sign out
          </button>
        </form>
      </header>
      <div className="mt-6 space-y-6">{children}</div>
    </main>
  );
}
```

- [ ] **Step 9: Check and commit**

```bash
cd packages/core && npx vitest run src/portal/cookies.test.ts && cd ../..
npx prettier --write packages/core/src/portal/cookies.ts packages/core/src/portal/cookies.test.ts packages/core/src/portal/index.ts apps/portal/next.config.ts apps/portal/src/lib/session.ts apps/portal/src/lib/form.ts apps/portal/src/lib/form-state.ts apps/portal/src/components apps/portal/src/app/actions.ts "apps/portal/src/app/q/[token]/page.tsx" "apps/portal/src/app/q/[token]/actions.ts"
npm run typecheck
npm run lint
npm run test
git add packages/core/src/portal/cookies.ts packages/core/src/portal/cookies.test.ts packages/core/src/portal/index.ts apps/portal/next.config.ts apps/portal/src/lib/session.ts apps/portal/src/lib/form.ts apps/portal/src/lib/form-state.ts apps/portal/src/components apps/portal/src/app/actions.ts "apps/portal/src/app/q/[token]/page.tsx" "apps/portal/src/app/q/[token]/actions.ts"
git commit -m "Add portal session helpers, signed-in headers, shared quote forms and sign out

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: all pass. The `git mv` / `git rm` from Step 6 are already staged and go into this commit. Then start the portal (`npm run dev:portal`, Git Bash) and open one private link page (`/q/<code>` from a staff quote) to confirm it still renders and the accept form still shows; stop the server.

---

### Task 11: Portal pages: sign in, enter the code, welcome

**Files:**
- Create: `apps/portal/src/app/sign-in/page.tsx`, `sign-in-form.tsx`, `actions.ts`
- Create: `apps/portal/src/app/sign-in/code/page.tsx`, `code-form.tsx`
- Create: `apps/portal/src/app/welcome/page.tsx`, `welcome-form.tsx`, `actions.ts`

**Interfaces:**
- Consumes: `getPortalDb`, `inPortalTx`, `sendEmail`, `DomainError` (`@ace/core`); `requestSignInCode`, `verifySignInCode`, `normaliseEmail`, `signInCodeEmail`, `getWelcomeStep`, `completeWelcome`, `welcomeSchema`, `CODE_TTL_MINUTES`, `type SignInCodeMessage`, `type WelcomeStep` (`@ace/core/portal`); `getSession`, `requireSession`, `setSessionCookie`, `setPendingEmail`, `readPendingEmail`, `clearPendingEmail` (Task 10); `formValues`, `errorsFrom`, `guardAction`, `BAD_REQUEST` (Task 10); `FormState` (Task 10); `PageShell`, `Notice` (Task 10, `@/components/notices`); `SignedInShell` (Task 10); `fieldClass`, `primaryButtonClass` (Task 10); `getVisitor` (`@/lib/visitor`); `after` (`next/server`).
- Produces: `requestCodeAction(prev: FormState, formData: FormData): Promise<FormState>`, `verifyCodeAction(prev: FormState, formData: FormData): Promise<FormState>` (`sign-in/actions.ts`); `completeWelcomeAction(prev: FormState, formData: FormData): Promise<FormState>` (`welcome/actions.ts`).

Screen words (no em dashes): the reply after asking for a code is always the same page: "If that email is on file, we have sent a code." The code page says the code works for 10 minutes. Wrong code: "That code is not right. Check the email and try again." Dead or used code: "That code has expired or has already been used. Ask for a new code." Too many requests: "Too many code requests. Please wait an hour and try again."

- [ ] **Step 1: Sign-in actions** (`apps/portal/src/app/sign-in/actions.ts`)

```ts
"use server";

import { getPortalDb, sendEmail } from "@ace/core";
import {
  normaliseEmail,
  requestSignInCode,
  signInCodeEmail,
  verifySignInCode,
  type SignInCodeMessage,
} from "@ace/core/portal";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { BAD_REQUEST, formValues, guardAction } from "@/lib/form";
import type { FormState } from "@/lib/form-state";
import { clearPendingEmail, readPendingEmail, setPendingEmail, setSessionCookie } from "@/lib/session";
import { getVisitor } from "@/lib/visitor";

const TOO_MANY_CODES = "Too many code requests. Please wait an hour and try again.";

/**
 * Sends the code after the response, so the reply takes the same time whether or not the email is on file.
 * A failure is logged with fixed words only; the visitor sees nothing different.
 */
function sendLater(message: SignInCodeMessage): Promise<void> {
  after(async () => {
    try {
      await sendEmail(signInCodeEmail(message));
    } catch {
      console.error("A sign-in code email could not be sent.");
    }
  });
  return Promise.resolve();
}

export async function requestCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const visitor = await getVisitor();
  // Link previews, crawlers and clients with no browser string never get a code.
  if (visitor.isBot) return { error: BAD_REQUEST, values, nonce: Date.now() };
  const typed = values.email ?? "";
  const result = await requestSignInCode(
    getPortalDb(),
    { email: typed, ipHash: visitor.ipHash },
    { send: sendLater },
  );
  if (result.outcome === "INVALID_EMAIL") {
    return { fieldErrors: { email: "Enter a valid email address." }, values, nonce: Date.now() };
  }
  if (result.outcome === "LIMITED") return { error: TOO_MANY_CODES, values, nonce: Date.now() };
  // SENT and NO_MATCH: exactly the same cookie, page and words, so nobody can tell which it was.
  await setPendingEmail(normaliseEmail(typed) ?? "");
  redirect("/sign-in/code");
}

export async function verifyCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  // Bots are refused, and every try counts against the visitor's action allowance.
  const guarded = await guardAction({});
  if ("refused" in guarded) return guarded.refused;
  const email = await readPendingEmail();
  if (!email) redirect("/sign-in");
  const result = await verifySignInCode(getPortalDb(), { email, code: values.code ?? "" });
  if (result.outcome === "WRONG") {
    return {
      fieldErrors: { code: "That code is not right. Check the email and try again." },
      nonce: Date.now(),
    };
  }
  if (result.outcome === "EXPIRED") {
    return {
      error: "That code has expired or has already been used. Ask for a new code.",
      nonce: Date.now(),
    };
  }
  await setSessionCookie(result.token, result.expiresAt);
  await clearPendingEmail();
  redirect(result.needsWelcome ? "/welcome" : "/");
}
```

(The typed code is never sent back to the browser in a refusal.)

- [ ] **Step 2: The sign-in page and form**

`apps/portal/src/app/sign-in/page.tsx`:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Notice, PageShell } from "@/components/notices";
import { getSession } from "@/lib/session";
import { getVisitor } from "@/lib/visitor";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in to the ACE client portal",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const visitor = await getVisitor();
  if (visitor.isBot) {
    return (
      <PageShell>
        <Notice title="ACE client portal">
          <p>Open this page in your browser to sign in.</p>
        </Notice>
      </PageShell>
    );
  }
  if (await getSession()) redirect("/");
  return (
    <PageShell>
      <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-charcoal/10 sm:p-8">
        <h1 className="font-display text-2xl font-semibold text-forest">Sign in</h1>
        <p className="text-charcoal/80">
          Enter your email address and we will email you a 6-digit code. There is no password.
        </p>
        <SignInForm />
      </section>
    </PageShell>
  );
}
```

`apps/portal/src/app/sign-in/sign-in-form.tsx`:

```tsx
"use client";

import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { useActionState, useRef } from "react";
import { fieldClass, primaryButtonClass } from "@/components/form-classes";
import { requestCodeAction } from "./actions";

export function SignInForm() {
  const [state, action, pending] = useActionState(requestCodeAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  const error = state?.fieldErrors?.email;
  return (
    <form ref={formRef} action={action} className="space-y-4">
      {state?.error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-200"
        >
          {state.error}
        </p>
      ) : null}
      <div key={state?.nonce ?? "initial"}>
        <label htmlFor="email" className="font-semibold text-charcoal">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          inputMode="email"
          defaultValue={state?.values?.email ?? ""}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "email-error" : undefined}
          className={fieldClass}
        />
        {error ? (
          <p id="email-error" className="mt-1 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Sending..." : "Email me a code"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: The code page and form**

`apps/portal/src/app/sign-in/code/page.tsx`:

```tsx
import { CODE_TTL_MINUTES } from "@ace/core/portal";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice, PageShell } from "@/components/notices";
import { readPendingEmail } from "@/lib/session";
import { getVisitor } from "@/lib/visitor";
import { CodeForm } from "./code-form";

export const metadata: Metadata = {
  title: "Enter your sign-in code",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function CodePage() {
  const visitor = await getVisitor();
  if (visitor.isBot) {
    return (
      <PageShell>
        <Notice title="ACE client portal">
          <p>Open this page in your browser to sign in.</p>
        </Notice>
      </PageShell>
    );
  }
  const email = await readPendingEmail();
  if (!email) redirect("/sign-in");
  return (
    <PageShell>
      <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-charcoal/10 sm:p-8">
        <h1 className="font-display text-2xl font-semibold text-forest">Check your email</h1>
        <p className="break-words text-charcoal/80">
          If that email is on file, we have sent a code to {email}. It works once, for {CODE_TTL_MINUTES}{" "}
          minutes.
        </p>
        <CodeForm />
        <p>
          <Link
            href="/sign-in"
            prefetch={false}
            className="inline-flex min-h-10 items-center text-sm font-semibold text-forest underline"
          >
            Use a different email or ask for a new code
          </Link>
        </p>
      </section>
    </PageShell>
  );
}
```

`apps/portal/src/app/sign-in/code/code-form.tsx`:

```tsx
"use client";

import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { useActionState, useRef } from "react";
import { fieldClass, primaryButtonClass } from "@/components/form-classes";
import { verifyCodeAction } from "../actions";

export function CodeForm() {
  const [state, action, pending] = useActionState(verifyCodeAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  const error = state?.fieldErrors?.code;
  return (
    <form ref={formRef} action={action} className="space-y-4">
      {state?.error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-200"
        >
          {state.error}
        </p>
      ) : null}
      <div key={state?.nonce ?? "initial"}>
        <label htmlFor="code" className="font-semibold text-charcoal">
          6-digit code
        </label>
        <input
          id="code"
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "code-error" : undefined}
          className={`${fieldClass} tracking-[0.3em]`}
        />
        {error ? (
          <p id="code-error" className="mt-1 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Checking..." : "Sign in"}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Welcome**

`apps/portal/src/app/welcome/actions.ts`:

```ts
"use server";

import { DomainError, inPortalTx } from "@ace/core";
import { completeWelcome, welcomeSchema } from "@ace/core/portal";
import { redirect } from "next/navigation";
import { BAD_REQUEST, errorsFrom, formValues } from "@/lib/form";
import type { FormState } from "@/lib/form-state";
import { requireSession } from "@/lib/session";

export async function completeWelcomeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession({ allowUnwelcomed: true });
  const values = formValues(formData);
  const parsed = welcomeSchema.safeParse({
    contactId: values.contactId ?? "",
    name: values.name ?? "",
    phone: values.phone ?? "",
    billingLine1: values.billingLine1 ?? "",
    billingLine2: values.billingLine2 ?? "",
    billingSuburb: values.billingSuburb ?? "",
    billingCity: values.billingCity ?? "",
    billingPostalCode: values.billingPostalCode ?? "",
    consent: values.consent ?? "",
  });
  if (!parsed.success) {
    const fieldErrors = errorsFrom(parsed.error);
    return {
      fieldErrors,
      ...("contactId" in fieldErrors ? { error: BAD_REQUEST } : {}),
      values,
      nonce: Date.now(),
    };
  }
  try {
    await inPortalTx((tx) => completeWelcome(tx, session.scope, parsed.data));
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, values, nonce: Date.now() };
    throw error;
  }
  // The page shows the next contact to welcome, or goes home when all are done.
  redirect("/welcome");
}
```

`apps/portal/src/app/welcome/page.tsx`:

```tsx
import { getPortalDb } from "@ace/core";
import { getWelcomeStep } from "@ace/core/portal";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignedInShell } from "@/components/signed-in-shell";
import { requireSession } from "@/lib/session";
import { WelcomeForm } from "./welcome-form";

export const metadata: Metadata = {
  title: "Welcome to the ACE client portal",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const session = await requireSession({ allowUnwelcomed: true });
  const step = await getWelcomeStep(getPortalDb(), session.scope);
  if (!step) redirect("/");
  return (
    <SignedInShell>
      <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-charcoal/10 sm:p-8">
        <h1 className="font-display text-2xl font-semibold text-forest">Welcome</h1>
        <p className="text-charcoal/80">
          Please check your details. You only need to do this once
          {step.remaining > 1 ? `, for each of the ${step.remaining} accounts linked to your email` : ""}.
        </p>
        <WelcomeForm step={step} />
      </section>
    </SignedInShell>
  );
}
```

`apps/portal/src/app/welcome/welcome-form.tsx`:

```tsx
"use client";

import type { WelcomeStep } from "@ace/core/portal";
import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { useActionState, useRef } from "react";
import { fieldClass, primaryButtonClass } from "@/components/form-classes";
import { completeWelcomeAction } from "./actions";

type Field = { name: string; label: string; max: number; autoComplete: string; optional?: boolean };

const BILLING: Field[] = [
  { name: "billingLine1", label: "Street address", max: 150, autoComplete: "address-line1", optional: true },
  { name: "billingLine2", label: "Address line 2", max: 150, autoComplete: "address-line2", optional: true },
  { name: "billingSuburb", label: "Suburb", max: 80, autoComplete: "address-level3", optional: true },
  { name: "billingCity", label: "City or town", max: 80, autoComplete: "address-level2", optional: true },
  { name: "billingPostalCode", label: "Postal code", max: 10, autoComplete: "postal-code", optional: true },
];

export function WelcomeForm({ step }: { step: WelcomeStep }) {
  const [state, action, pending] = useActionState(completeWelcomeAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, state?.nonce);
  const e = state?.fieldErrors ?? {};
  const start: Record<string, string> = {
    name: step.name,
    phone: step.phone ?? "",
    billingLine1: step.billing.billingLine1 ?? "",
    billingLine2: step.billing.billingLine2 ?? "",
    billingSuburb: step.billing.billingSuburb ?? "",
    billingCity: step.billing.billingCity ?? "",
    billingPostalCode: step.billing.billingPostalCode ?? "",
  };
  const v = state?.values ?? start;
  const input = (f: Field, type = "text") => (
    <div key={f.name}>
      <label htmlFor={f.name} className="font-semibold text-charcoal">
        {f.label}
        {f.optional ? <span className="font-normal text-charcoal/60"> (optional)</span> : null}
      </label>
      <input
        id={f.name}
        name={f.name}
        type={type}
        maxLength={f.max}
        autoComplete={f.autoComplete}
        required={!f.optional}
        defaultValue={v[f.name] ?? ""}
        aria-invalid={e[f.name] ? true : undefined}
        aria-describedby={e[f.name] ? `${f.name}-error` : undefined}
        className={fieldClass}
      />
      {e[f.name] ? (
        <p id={`${f.name}-error`} className="mt-1 text-sm text-red-700">
          {e[f.name]}
        </p>
      ) : null}
    </div>
  );
  return (
    <form ref={formRef} action={action} className="space-y-5">
      {state?.error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-200"
        >
          {state.error}
        </p>
      ) : null}
      <input type="hidden" name="contactId" value={step.contactId} />
      <div key={state?.nonce ?? "initial"} className="space-y-5">
        <p className="break-words text-sm text-charcoal/70">
          Your email (this is how you sign in): <span className="font-semibold">{step.email}</span>
        </p>
        {input({ name: "name", label: "Your name", max: 120, autoComplete: "name" })}
        {input({ name: "phone", label: "Phone", max: 30, autoComplete: "tel", optional: true }, "tel")}
        <fieldset className="space-y-4">
          <legend className="font-display text-lg font-semibold text-forest">
            Billing address{step.isCompany ? ` for ${step.customerName}` : ""}
          </legend>
          {BILLING.map((f) => input(f))}
        </fieldset>
        <div>
          <label className="flex min-h-11 items-start gap-3 py-1">
            <input
              type="checkbox"
              name="consent"
              required
              defaultChecked={v.consent === "on"}
              aria-invalid={e.consent ? true : undefined}
              aria-describedby={e.consent ? "consent-error" : undefined}
              className="mt-1 h-5 w-5 shrink-0 accent-forest"
            />
            <span>
              I agree that ACE Garden Services may keep these details to quote, provide and bill its
              services, and to contact me about them (POPIA).
            </span>
          </label>
          {e.consent ? (
            <p id="consent-error" className="mt-1 text-sm text-red-700">
              {e.consent}
            </p>
          ) : null}
        </div>
      </div>
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Saving..." : "Save and continue"}
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Check, look, commit**

```bash
npx prettier --write apps/portal/src/app/sign-in apps/portal/src/app/welcome
npm run typecheck
npm run lint
git add apps/portal/src/app/sign-in apps/portal/src/app/welcome
git commit -m "Add the portal sign-in, code and welcome pages

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: typecheck and lint pass. Then in Git Bash start `npm run dev:portal`, open `http://localhost:3200/sign-in` at 375px width, type a made-up address (`zz.nobody@example.com`), and confirm you reach `/sign-in/code` with the "If that email is on file" words and that no code is printed in the dev server console (unknown email). Stop the server. (The full sign-in with a real made-up client is the controller's browser check.)

---

### Task 12: Portal pages: home (My complexes), the quote page, the PDF and the portal accept

**Files:**
- Modify: `apps/portal/src/app/page.tsx` (replace the placeholder)
- Create: `apps/portal/src/app/home-groups.tsx`
- Create: `apps/portal/src/components/quote-outcome.tsx`
- Create: `apps/portal/src/app/quotes/[id]/page.tsx`, `actions.ts`, `not-found.tsx`, `pdf/route.ts`
- Modify: `apps/portal/src/app/q/[token]/page.tsx` (use `AcceptedNotice`)

**Interfaces:**
- Consumes: `getPortalDb`, `inPortalTx`, `checkRateLimit`, `linkDeclineSchema`, `DomainError`, `todaySA`, `type PublicQuoteView` (`@ace/core`); `getPortalHome`, `getPortalQuote`, `acceptPortalQuote`, `declinePortalQuote`, `type PortalCustomerGroup`, `type PortalQuoteSummary`, `type PortalQuoteState` (`@ace/core/portal`); `QuoteDocumentView` (`@ace/ui/quote-document`), `QuotePdf` (`@ace/ui/quote-pdf`); `requireSession`, `getSession` (Task 10); `acceptFormValues`, `parseAcceptForm`, `formValues`, `errorsFrom`, `guardAction` (Task 10); `AcceptForm`, `DeclineForm`, `SignedInShell`, `Notice`, `Contact`, `fieldClass`, `secondaryButtonClass` (Task 10); `grantPortalAccessLater` (Task 9); `getVisitor`.
- Produces: `acceptPortalQuoteAction(quoteId: string, prev: FormState, formData: FormData): Promise<FormState>`, `declinePortalQuoteAction(quoteId: string, prev: FormState, formData: FormData): Promise<FormState>`; `AcceptedNotice({ acceptance, pdfHref }: { acceptance: PublicQuoteView["acceptance"]; pdfHref: string })`; `CustomerGroup` and `QuoteList` server components in `home-groups.tsx`.

The quote page never shows email, phone or internal notes (the view has none). A quote outside the scope, a draft, a withdrawn or replaced quote, or a malformed id all show the same "not available" page. The PDF route is rate limited (real 429), refuses bots and anyone not signed in with a 404, and is `no-store`.

- [ ] **Step 1: The accepted notice, shared by the link page and the portal**

`apps/portal/src/components/quote-outcome.tsx`:

```tsx
import type { PublicQuoteView } from "@ace/core";
import { Notice } from "@/components/notices";

const pdfLinkClass =
  "inline-flex min-h-11 items-center text-sm font-semibold text-forest underline";

export function PdfLink({ href }: { href: string }) {
  return (
    <a href={href} className={pdfLinkClass}>
      Download a PDF copy
    </a>
  );
}

export function AcceptedNotice({
  acceptance,
  pdfHref,
}: {
  acceptance: PublicQuoteView["acceptance"];
  pdfHref: string;
}) {
  return (
    <Notice title="Thank you, this quotation has been accepted" tone="good">
      {acceptance?.name ? <p>Accepted by {acceptance.name}.</p> : null}
      {acceptance?.at ? <p>Accepted on {acceptance.at}.</p> : null}
      {acceptance?.startDate ? <p>Service starts on {acceptance.startDate}.</p> : null}
      <p>
        Optional add-ons chosen:{" "}
        {acceptance && acceptance.chosen.length > 0 ? acceptance.chosen.join(", ") : "none"}.
      </p>
      <p className="pt-1">
        <PdfLink href={pdfHref} />
      </p>
    </Notice>
  );
}
```

In `apps/portal/src/app/q/[token]/page.tsx`: add `import { AcceptedNotice, PdfLink } from "@/components/quote-outcome";`, delete the local `pdfLinkClass` constant, replace the whole `<Notice title="Thank you, this quotation has been accepted" tone="good"> ... </Notice>` element in the `ACCEPTED` case with `<AcceptedNotice acceptance={quote.acceptance} pdfHref={pdfHref} />`, and replace the `<p><a href={pdfHref} className={pdfLinkClass}>Download a PDF copy</a></p>` in the `OPEN` case with `<p><PdfLink href={pdfHref} /></p>`.

- [ ] **Step 2: Portal accept and decline actions** (`apps/portal/src/app/quotes/[id]/actions.ts`)

```ts
"use server";

import { DomainError, inPortalTx, linkDeclineSchema } from "@ace/core";
import { acceptPortalQuote, declinePortalQuote } from "@ace/core/portal";
import { redirect } from "next/navigation";
import {
  acceptFormValues,
  errorsFrom,
  formValues,
  guardAction,
  parseAcceptForm,
} from "@/lib/form";
import type { FormState } from "@/lib/form-state";
import { grantPortalAccessLater } from "@/lib/portal-access";
import { requireSession } from "@/lib/session";

/** Every outcome except a typing mistake goes back to the quote page, which shows the true state. */
const backToQuote = (quoteId: string): never => redirect(`/quotes/${encodeURIComponent(quoteId)}`);

export async function acceptPortalQuoteAction(
  quoteId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireSession();
  const values = acceptFormValues(formData);
  const guarded = await guardAction(values);
  if ("refused" in guarded) return guarded.refused;
  const parsed = parseAcceptForm(formData, values);
  if ("state" in parsed) return parsed.state;
  let result: Awaited<ReturnType<typeof acceptPortalQuote>>;
  try {
    result = await inPortalTx((tx) =>
      acceptPortalQuote(tx, session.scope, quoteId, parsed.data, {
        ip: guarded.visitor.ip,
        userAgent: guarded.visitor.userAgent,
      }),
    );
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, values, nonce: Date.now() };
    throw error;
  }
  if (result.outcome === "ACCEPTED") grantPortalAccessLater(result.quoteId);
  return backToQuote(quoteId);
}

export async function declinePortalQuoteAction(
  quoteId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireSession();
  const values = formValues(formData);
  const guarded = await guardAction(values);
  if ("refused" in guarded) return guarded.refused;
  const parsed = linkDeclineSchema.safeParse({ reason: values.reason ?? "" });
  if (!parsed.success) return { fieldErrors: errorsFrom(parsed.error), values, nonce: Date.now() };
  try {
    await inPortalTx((tx) => declinePortalQuote(tx, session.scope, quoteId, parsed.data));
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, values, nonce: Date.now() };
    throw error;
  }
  return backToQuote(quoteId);
}
```

- [ ] **Step 3: The quote page and its not-found page**

`apps/portal/src/app/quotes/[id]/not-found.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "This quote is not available",
  robots: { index: false, follow: false },
};

export default function QuoteNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10 text-center">
      <p className="text-xs font-semibold tracking-[0.18em] text-ochre uppercase">ACE Garden Services</p>
      <h1 className="mt-3 font-display text-3xl font-semibold text-forest">This quote is not available</h1>
      <p className="mt-4 text-charcoal/70">It may have been replaced or withdrawn.</p>
      <p className="mt-6">
        <Link href="/" prefetch={false} className="inline-flex min-h-11 items-center font-semibold text-forest underline">
          Back to your quotes
        </Link>
      </p>
    </main>
  );
}
```

`apps/portal/src/app/quotes/[id]/page.tsx`:

```tsx
import { getPortalDb, todaySA } from "@ace/core";
import { getPortalQuote } from "@ace/core/portal";
import { QuoteDocumentView } from "@ace/ui/quote-document";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Contact, Notice } from "@/components/notices";
import { AcceptedNotice, PdfLink } from "@/components/quote-outcome";
import { AcceptForm } from "@/components/quote-forms/accept-form";
import { DeclineForm } from "@/components/quote-forms/decline-form";
import { SignedInShell } from "@/components/signed-in-shell";
import { requireSession } from "@/lib/session";
import { acceptPortalQuoteAction, declinePortalQuoteAction } from "./actions";

// Titles and descriptions never hold customer details.
export const metadata: Metadata = {
  title: "Your quotation from ACE Garden Services",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function PortalQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  // The scope is enforced inside the query: a quote of another customer is simply not found.
  const quote = await getPortalQuote(getPortalDb(), session.scope, id);
  if (!quote) notFound();

  const pdfHref = `/quotes/${encodeURIComponent(quote.id)}/pdf`;
  const contact = <Contact phone={quote.business.phone} email={quote.business.email} />;
  const back = (
    <Link href="/" prefetch={false} className="inline-flex min-h-10 items-center text-sm font-semibold text-forest underline">
      Back to your quotes
    </Link>
  );

  switch (quote.state) {
    case "ACCEPTED":
      return (
        <SignedInShell>
          {back}
          <AcceptedNotice acceptance={quote.acceptance} pdfHref={pdfHref} />
          <QuoteDocumentView doc={quote.doc} />
        </SignedInShell>
      );
    case "DECLINED":
      return (
        <SignedInShell>
          {back}
          <Notice title="This quotation was declined">
            {quote.declinedAt ? <p>Declined on {quote.declinedAt}.</p> : null}
            {contact}
          </Notice>
          <p>
            <PdfLink href={pdfHref} />
          </p>
          <QuoteDocumentView doc={quote.doc} />
        </SignedInShell>
      );
    case "EXPIRED":
      return (
        <SignedInShell>
          {back}
          <Notice title="This quotation has expired">
            <p>Please contact ACE Garden Services.</p>
            {contact}
          </Notice>
          <QuoteDocumentView doc={quote.doc} />
        </SignedInShell>
      );
    case "OPEN":
      return (
        <SignedInShell>
          {back}
          <QuoteDocumentView doc={quote.doc} />
          <p>
            <PdfLink href={pdfHref} />
          </p>
          <AcceptForm
            action={acceptPortalQuoteAction.bind(null, quote.id)}
            reference={quote.reference}
            optionalLines={quote.optionalLines}
            today={todaySA()}
          />
          <DeclineForm action={declinePortalQuoteAction.bind(null, quote.id)} />
        </SignedInShell>
      );
    default:
      notFound();
  }
}
```

- [ ] **Step 4: The PDF route** (`apps/portal/src/app/quotes/[id]/pdf/route.ts`)

```ts
import { checkRateLimit, getPortalDb } from "@ace/core";
import { getPortalQuote } from "@ace/core/portal";
import { QuotePdf } from "@ace/ui/quote-pdf";
import { renderToBuffer } from "@react-pdf/renderer";
import { getSession } from "@/lib/session";
import { getVisitor } from "@/lib/visitor";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
const notFound = () => new Response("Not found", { status: 404, headers: NO_STORE });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const visitor = await getVisitor();
  // Link previews, crawlers and clients with no browser string get nothing, and use up no allowance.
  if (visitor.isBot) return notFound();
  const db = getPortalDb();
  // A route can answer with a real 429 (a page cannot).
  if (!(await checkRateLimit(db, "view", visitor.ipHash)).allowed) {
    return new Response("Too many requests. Please try again in a few minutes.", {
      status: 429,
      headers: { ...NO_STORE, "Retry-After": "600" },
    });
  }
  const session = await getSession();
  if (!session) return notFound();
  const quote = await getPortalQuote(db, session.scope, id);
  if (!quote) return notFound();
  // Called as a function so the element is typed as the Document renderToBuffer expects.
  const buffer = await renderToBuffer(QuotePdf({ doc: quote.doc }));
  const filename = `${quote.reference.replaceAll(" ", "-")}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
```

- [ ] **Step 5: Home and My complexes**

`apps/portal/src/app/home-groups.tsx` (server components only):

```tsx
import type { PortalCustomerGroup, PortalQuoteState, PortalQuoteSummary } from "@ace/core/portal";
import Link from "next/link";

const STATE_LABELS: Record<PortalQuoteState, string> = {
  OPEN: "Open",
  EXPIRED: "Expired",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
};
const STATE_STYLES: Record<PortalQuoteState, string> = {
  OPEN: "bg-forest text-cream",
  EXPIRED: "bg-charcoal/10 text-charcoal",
  ACCEPTED: "bg-forest/10 text-forest",
  DECLINED: "bg-red-50 text-red-800",
};
const CUSTOMER_STATUS: Record<string, string> = {
  LEAD: "New",
  ACTIVE: "Active",
  PAUSED: "Paused",
  ARCHIVED: "Archived",
};

export function QuoteList({ quotes }: { quotes: PortalQuoteSummary[] }) {
  if (quotes.length === 0) return <p className="text-sm text-charcoal/60">No quotes yet.</p>;
  return (
    <ul className="space-y-2">
      {quotes.map((q) => (
        <li key={q.id}>
          <Link
            href={`/quotes/${q.id}`}
            prefetch={false}
            className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg bg-cream/60 px-3 py-2 ring-1 ring-charcoal/10 hover:ring-forest/40"
          >
            <span className="font-semibold text-forest">{q.reference}</span>
            <span className="flex flex-wrap items-center gap-2 text-sm text-charcoal/70">
              {q.state === "OPEN" ? <span>Valid until {q.validUntil}</span> : null}
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATE_STYLES[q.state]}`}>
                {STATE_LABELS[q.state]}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function CustomerGroup({
  group,
  open,
  showStatus,
}: {
  group: PortalCustomerGroup;
  open: boolean;
  showStatus: boolean;
}) {
  return (
    <details open={open} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-charcoal/10 sm:p-5">
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 font-display text-lg font-semibold text-forest">
        <span className="min-w-0 break-words">{group.name}</span>
        {showStatus ? (
          <span className="rounded-full bg-forest/10 px-2.5 py-0.5 font-sans text-xs font-semibold text-forest">
            {CUSTOMER_STATUS[group.status] ?? group.status}
          </span>
        ) : null}
      </summary>
      <div className="mt-3 space-y-4">
        {group.properties.map((p) => (
          <div key={p.id} className="space-y-2">
            <div>
              <h3 className="font-semibold text-charcoal">{p.label}</h3>
              {p.address ? <p className="break-words text-sm text-charcoal/60">{p.address}</p> : null}
            </div>
            <QuoteList quotes={p.quotes} />
          </div>
        ))}
        {group.otherQuotes.length > 0 ? (
          <div className="space-y-2">
            <h3 className="font-semibold text-charcoal">Other quotes</h3>
            <QuoteList quotes={group.otherQuotes} />
          </div>
        ) : null}
        {group.properties.length === 0 && group.otherQuotes.length === 0 ? (
          <p className="text-sm text-charcoal/60">Nothing to show yet.</p>
        ) : null}
      </div>
    </details>
  );
}
```

Replace `apps/portal/src/app/page.tsx` with:

```tsx
import { getPortalDb } from "@ace/core";
import { getPortalHome } from "@ace/core/portal";
import type { Metadata } from "next";
import { fieldClass, secondaryButtonClass } from "@/components/form-classes";
import { SignedInShell } from "@/components/signed-in-shell";
import { requireSession } from "@/lib/session";
import { CustomerGroup } from "./home-groups";

export const metadata: Metadata = {
  title: "Your quotes from ACE Garden Services",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const home = await getPortalHome(getPortalDb(), session.scope, { q });
  // Collapsed by default when there are many groups.
  const open = home.groups.length <= 3;
  return (
    <SignedInShell>
      <h1 className="font-display text-2xl font-semibold text-forest">
        {home.hasManaged ? "My complexes" : "Your quotes"}
      </h1>
      {home.hasManaged ? (
        <form method="get" role="search" className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="q" className="text-sm font-semibold text-charcoal">
              Search by complex name
            </label>
            <input id="q" name="q" type="search" maxLength={80} defaultValue={q} className={fieldClass} />
          </div>
          <button type="submit" className={secondaryButtonClass}>
            Search
          </button>
        </form>
      ) : null}
      {home.groups.length === 0 ? (
        <p className="text-charcoal/70">
          {q ? "No complex matches that name." : "There is nothing to show yet."}
        </p>
      ) : (
        home.groups.map((g) => (
          <CustomerGroup key={g.id} group={g} open={open} showStatus={home.hasManaged} />
        ))
      )}
    </SignedInShell>
  );
}
```

- [ ] **Step 6: Check, look, commit**

```bash
npx prettier --write apps/portal/src/app/page.tsx apps/portal/src/app/home-groups.tsx apps/portal/src/components/quote-outcome.tsx "apps/portal/src/app/quotes" "apps/portal/src/app/q/[token]/page.tsx"
npm run typecheck
npm run lint
git add apps/portal/src/app/page.tsx apps/portal/src/app/home-groups.tsx apps/portal/src/components/quote-outcome.tsx "apps/portal/src/app/quotes" "apps/portal/src/app/q/[token]/page.tsx"
git commit -m "Add the portal home (My complexes), the quote page with accept and decline, and the PDF

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: typecheck and lint pass. Then start `npm run dev:portal` and confirm `http://localhost:3200/` without a session redirects to `/sign-in`, and `http://localhost:3200/quotes/not-a-uuid/pdf` answers 404 (a browser user agent). Stop the server.

---
### Task 13: Staff screens: managing agency, the Portal panel, quote facts and history names

**Files:**
- Modify: `packages/core/src/quotes/drafts.ts` (`getQuote` includes the accepting contact)
- Modify: `packages/core/src/quotes/activity.ts` (`listQuoteActivity` names a portal act "Client (portal)")
- Modify: `packages/core/src/customers/customers.ts` (`listCustomerActivity` names by actor type)
- Create: `packages/core/src/portal/staff-views.db.test.ts`
- Modify: `apps/admin/src/app/(staff)/customers/actions.ts` (five new actions)
- Modify: `apps/admin/src/app/(staff)/customers/[id]/page.tsx`, `overview-tab.tsx`, `contacts-tab.tsx`, `activity-tab.tsx`, `owner-tools.tsx`
- Create: `apps/admin/src/app/(staff)/customers/[id]/hierarchy-panel.tsx`
- Modify: `apps/admin/src/app/(staff)/quotes/[id]/quote-facts.tsx`

**Interfaces:**
- Consumes: `getCustomerHierarchy`, `searchAgencies`, `setManagedBy`, `clearManagedBy`, `setBillsToManager`, `HIERARCHY_MESSAGES`, `HierarchyMessageKey`, `CustomerHierarchy`, `AgencyOption` (Task 5); `inviteContact`, `removeContactAccess`, `sendWelcomeEmails`, `PORTAL_ACCESS_MESSAGES` (Task 9); `sendEmail` (Task 4); `portalSignInUrl` (Task 3); `requireStaff`, `toActor`, `inTx`, `MANAGEMENT`, `DomainError`, `ForbiddenError`, `getDb`, `formatCustomerNumber`; test helpers (Task 6); `acceptPortalQuote` (Task 8); `completeWelcome` (Task 7); `grantAccessAfterAcceptance` (Task 9).
- Produces:
  - `getQuote` result gains `acceptedByContact: { id: string; name: string; customerId: string; customer: { id: string; displayName: string } } | null`.
  - `listQuoteActivity`: an entry with actor type CUSTOMER is named `"Client (portal)"` when its `after` has `method: "CLIENT_PORTAL"` or `via: "portal"`, otherwise `"Client (private link)"` (unchanged).
  - `listCustomerActivity` entries gain `actorType`; names: STAFF by name (or "Staff"), CUSTOMER `"Client"`, SYSTEM or no actor `"System"`.
  - Staff actions (each calls `requireStaff(MANAGEMENT)` first): `setManagedByAction(formData)`, `clearManagedByAction(formData)`, `setBillsToAction(formData)`, `inviteContactAction(formData)`, `removeContactAccessAction(formData)`, all `Promise<void>` ending in a redirect with a fixed code.
  - `HierarchyPanel` server component (`hierarchy-panel.tsx`).

The address bar only ever carries fixed codes (`link=<code>`, `error=<code>`); the page turns them into words. Server components here pass only server actions to forms; no event handlers. Client components (there are none new) would use `@ace/core/client`.

- [ ] **Step 1: Write the failing test** `packages/core/src/portal/staff-views.db.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { listCustomerActivity } from "../customers/customers";
import { listQuoteActivity } from "../quotes/activity";
import { getQuote } from "../quotes/drafts";
import { addDays, todaySA } from "../quotes/reference";
import { manager, token } from "../quotes/test-helpers";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { grantAccessAfterAcceptance } from "./access";
import { acceptPortalQuote } from "./quotes";
import { addPortalContact, issueFor, makeClient, scopeOf } from "./test-helpers";
import { completeWelcome } from "./welcome";

describe.skipIf(!dbTestsEnabled)("what staff see of portal acts", () => {
  it("shows who accepted in the portal and for which agency, and names the client and the system in the history", async () => {
    await withRollback(async (tx) => {
      const agency = await makeClient(tx, { name: `ZZ E2E Agency ${token()}`, welcomed: false });
      const complex = await makeClient(tx, { managedById: agency.customerId });
      const uninvited = await addPortalContact(tx, complex.customerId, { access: false });
      const q = await issueFor(tx, complex);

      const result = await acceptPortalQuote(
        tx,
        await scopeOf(tx, agency.email),
        q,
        { acceptedBy: "ZZ E2E Agency Person", startDate: addDays(todaySA(), 4), chosenLineIds: [] },
        { ip: null, userAgent: "ZZ Test Browser" },
      );
      expect(result.outcome).toBe("ACCEPTED");
      const quote = await getQuote(tx, manager, q);
      expect(quote?.acceptedByContact).toMatchObject({
        id: agency.contactId,
        customerId: agency.customerId,
        customer: { id: agency.customerId, displayName: agency.name },
      });
      const history = await listQuoteActivity(tx, manager, q);
      expect(history.find((e) => e.action === "quote.accepted")?.actorName).toBe("Client (portal)");

      expect((await grantAccessAfterAcceptance(tx, q)).map((i) => i.contactId)).toEqual([uninvited.contactId]);
      const complexActivity = await listCustomerActivity(tx, manager, complex.customerId);
      const granted = complexActivity.find((e) => e.action === "customer.portal_access_granted");
      expect(granted).toMatchObject({ actorType: "SYSTEM", actorName: "System" });

      await completeWelcome(tx, await scopeOf(tx, agency.email), {
        contactId: agency.contactId,
        name: "ZZ E2E Agency Person",
        phone: null,
        billingLine1: null,
        billingLine2: null,
        billingSuburb: null,
        billingCity: null,
        billingPostalCode: null,
        consent: "on",
      });
      const agencyActivity = await listCustomerActivity(tx, manager, agency.customerId);
      const welcomed = agencyActivity.find((e) => e.action === "customer.portal_welcomed");
      expect(welcomed).toMatchObject({ actorType: "CUSTOMER", actorName: "Client" });
      const created = agencyActivity.find((e) => e.action === "customer.created");
      expect(created?.actorType).toBe("STAFF");
    });
  });
});
```

Run `npm run typecheck`: expect errors (`acceptedByContact` does not exist on the `getQuote` result; `actorType` not on `listCustomerActivity` entries).

- [ ] **Step 2: Core changes**

`packages/core/src/quotes/drafts.ts`, in `getQuote`'s `include`, add after `property: { ... }`:

```ts
      acceptedByContact: {
        select: {
          id: true,
          name: true,
          customerId: true,
          customer: { select: { id: true, displayName: true } },
        },
      },
```

`packages/core/src/quotes/activity.ts`: replace the `return entries.map(...)` with:

```ts
  /** A client act through the portal carries method CLIENT_PORTAL (acceptance) or via "portal" (decline). */
  const viaPortal = (after: unknown) => {
    const a = after as { method?: unknown; via?: unknown } | null;
    return a?.method === "CLIENT_PORTAL" || a?.via === "portal";
  };
  return entries.map((e) => ({
    ...e,
    actorName:
      e.actorType === "CUSTOMER"
        ? viaPortal(e.after)
          ? "Client (portal)"
          : "Client (private link)"
        : e.actorId
          ? (names.get(e.actorId) ?? "Staff")
          : "System",
  }));
```

`packages/core/src/customers/customers.ts`, in `listCustomerActivity`: add `actorType: true` to the `select`; build the staff id list only from STAFF entries:

```ts
  const ids = [
    ...new Set(
      entries
        .filter((e) => e.actorType === "STAFF")
        .map((e) => e.actorId)
        .filter((v): v is string => Boolean(v)),
    ),
  ];
```

and replace the final `return entries.map(...)` with:

```ts
  return entries.map((e) => ({
    ...e,
    actorName:
      e.actorType === "CUSTOMER"
        ? "Client"
        : e.actorType === "STAFF" && e.actorId
          ? (names.get(e.actorId) ?? "Staff")
          : "System",
  }));
```

- [ ] **Step 3: Staff actions** (`apps/admin/src/app/(staff)/customers/actions.ts`)

Add to the `@ace/core` import: `clearManagedBy`, `DomainError`, `ForbiddenError`, `getDb`, `HIERARCHY_MESSAGES`, `inviteContact`, `PORTAL_ACCESS_MESSAGES`, `portalSignInUrl`, `removeContactAccess`, `sendEmail`, `sendWelcomeEmails`, `setBillsToManager`, `setManagedBy`, and `type HierarchyMessageKey`. Append:

```ts
/** A refusal of the agency rules as a fixed code for the address bar (the page turns it back into words). */
function hierarchyCode(error: unknown): string {
  if (error instanceof ForbiddenError) redirect("/forbidden");
  if (error instanceof DomainError) {
    const keys = Object.keys(HIERARCHY_MESSAGES) as HierarchyMessageKey[];
    return keys.find((k) => HIERARCHY_MESSAGES[k] === error.message) ?? "generic";
  }
  throw error;
}

export async function setManagedByAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const customerId = idSchema.parse(formData.get("customerId"));
  const agencyId = idSchema.parse(formData.get("agencyId"));
  let code = "linked";
  try {
    await inTx((tx) => setManagedBy(tx, actor, customerId, agencyId));
  } catch (error) {
    code = hierarchyCode(error);
  }
  redirect(`/customers/${customerId}?tab=overview&link=${code}`);
}

export async function clearManagedByAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const customerId = idSchema.parse(formData.get("customerId"));
  let code = "cleared";
  try {
    await inTx((tx) => clearManagedBy(tx, actor, customerId));
  } catch (error) {
    code = hierarchyCode(error);
  }
  redirect(`/customers/${customerId}?tab=overview&link=${code}`);
}

export async function setBillsToAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const customerId = idSchema.parse(formData.get("customerId"));
  const choice = formData.get("billsTo");
  let code = "billing";
  if (choice !== "agency" && choice !== "complex") {
    code = "generic";
  } else {
    try {
      await inTx((tx) => setBillsToManager(tx, actor, customerId, choice === "agency"));
    } catch (error) {
      code = hierarchyCode(error);
    }
  }
  redirect(`/customers/${customerId}?tab=overview&link=${code}`);
}

/** A refusal of the portal access rules as a fixed code for the address bar. */
function portalCode(error: unknown): string {
  if (error instanceof ForbiddenError) redirect("/forbidden");
  if (error instanceof DomainError) {
    if (error.message === PORTAL_ACCESS_MESSAGES.noEmail) return "no-email";
    if (error.message === PORTAL_ACCESS_MESSAGES.archived) return "archived";
    return "portal-generic";
  }
  throw error;
}

/** Invite to portal: gives access, then sends the welcome after the change has committed. */
export async function inviteContactAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const contactId = idSchema.parse(formData.get("contactId"));
  const customerId = idSchema.parse(formData.get("customerId"));
  let code: string;
  try {
    const invite = await inTx((tx) => inviteContact(tx, actor, contactId));
    const { failed } = await sendWelcomeEmails(getDb(), [invite], {
      send: (message) => sendEmail(message),
      signInUrl: portalSignInUrl(),
    });
    code = failed > 0 ? "invite-failed" : "invited";
  } catch (error) {
    code = portalCode(error);
  }
  redirect(`/customers/${customerId}?tab=contacts&error=${code}`);
}

export async function removeContactAccessAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const contactId = idSchema.parse(formData.get("contactId"));
  const customerId = idSchema.parse(formData.get("customerId"));
  let code = "removed";
  try {
    await inTx((tx) => removeContactAccess(tx, actor, contactId));
  } catch (error) {
    code = portalCode(error);
  }
  redirect(`/customers/${customerId}?tab=contacts&error=${code}`);
}
```

- [ ] **Step 4: The managing-agency panel** (`apps/admin/src/app/(staff)/customers/[id]/hierarchy-panel.tsx`)

```tsx
import {
  HIERARCHY_MESSAGES,
  formatCustomerNumber,
  type AgencyOption,
  type CustomerHierarchy,
  type HierarchyMessageKey,
} from "@ace/core";
import Link from "next/link";
import { inputClass } from "@/components/auth-card";
import { secondaryButtonClass } from "@/components/form";
import { clearManagedByAction, setBillsToAction, setManagedByAction } from "../actions";

const SUCCESS: Record<string, string> = {
  linked: "Managing agency saved.",
  cleared: "Managing agency removed.",
  billing: "Billing choice saved.",
};

/** Only a fixed code arrives in the address bar; anything unknown shows nothing. */
function noticeFor(code: string | undefined): { text: string; ok: boolean } | null {
  if (!code) return null;
  if (Object.hasOwn(SUCCESS, code)) return { text: SUCCESS[code] ?? "", ok: true };
  if (Object.hasOwn(HIERARCHY_MESSAGES, code)) {
    return { text: HIERARCHY_MESSAGES[code as HierarchyMessageKey], ok: false };
  }
  if (code === "generic") return { text: "That could not be saved. Refresh the page and try again.", ok: false };
  return null;
}

export function HierarchyPanel({
  customerId,
  locked,
  hierarchy,
  agencyQuery,
  agencyResults,
  notice,
}: {
  customerId: string;
  locked: boolean;
  hierarchy: CustomerHierarchy;
  agencyQuery: string;
  agencyResults: AgencyOption[];
  notice: string | undefined;
}) {
  const message = noticeFor(notice);
  const manager = hierarchy.manager;
  const managesComplexes = hierarchy.complexes.length > 0;
  return (
    <section
      aria-labelledby="hierarchy-heading"
      className="space-y-4 rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10"
    >
      <h2 id="hierarchy-heading" className="font-display text-lg font-semibold text-forest">
        Managing agency
      </h2>
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={`rounded-lg px-3 py-2 text-sm ring-1 ${message.ok ? "bg-forest/10 text-forest ring-forest/25" : "bg-red-50 text-red-800 ring-red-200"}`}
        >
          {message.text}
        </p>
      ) : null}

      {manager ? (
        <div className="space-y-3">
          <p className="text-sm">
            Managed by{" "}
            <Link href={`/customers/${manager.id}`} className="font-semibold text-forest underline">
              {manager.displayName}
            </Link>{" "}
            <span className="text-charcoal/50">{formatCustomerNumber(manager.number)}</span>
          </p>
          {locked ? (
            <p className="text-sm">
              Bills go to: {hierarchy.billsToManager ? "the managing agency" : "this customer itself"}
            </p>
          ) : (
            <>
              <form action={setBillsToAction} className="space-y-2">
                <input type="hidden" name="customerId" value={customerId} />
                <fieldset className="space-y-1">
                  <legend className="text-sm font-semibold text-charcoal">Bills go to</legend>
                  <label className="flex min-h-10 items-center gap-3 text-sm">
                    <input
                      type="radio"
                      name="billsTo"
                      value="agency"
                      defaultChecked={hierarchy.billsToManager}
                      className="h-4 w-4 accent-forest"
                    />
                    The managing agency
                  </label>
                  <label className="flex min-h-10 items-center gap-3 text-sm">
                    <input
                      type="radio"
                      name="billsTo"
                      value="complex"
                      defaultChecked={!hierarchy.billsToManager}
                      className="h-4 w-4 accent-forest"
                    />
                    This customer itself
                  </label>
                </fieldset>
                <button type="submit" className={secondaryButtonClass}>
                  Save billing choice
                </button>
              </form>
              <form action={clearManagedByAction}>
                <input type="hidden" name="customerId" value={customerId} />
                <button type="submit" className={secondaryButtonClass}>
                  Remove managing agency
                </button>
              </form>
            </>
          )}
        </div>
      ) : managesComplexes ? (
        <p className="text-sm text-charcoal/70">
          This customer manages complexes, so it cannot itself be managed by an agency.
        </p>
      ) : (
        <p className="text-sm text-charcoal/70">Not managed by an agency.</p>
      )}

      {!locked && !managesComplexes ? (
        <div className="space-y-2">
          <form method="get" role="search" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tab" value="overview" />
            <label className="block min-w-0 flex-1 text-sm font-medium text-charcoal">
              {manager ? "Move to another agency" : "Find the managing agency"}
              <input
                name="agencyQ"
                type="search"
                maxLength={80}
                defaultValue={agencyQuery}
                placeholder="Agency name"
                className={inputClass}
              />
            </label>
            <button type="submit" className={secondaryButtonClass}>
              Search
            </button>
          </form>
          {agencyQuery && agencyResults.length === 0 ? (
            <p className="text-sm text-charcoal/60">No customer by that name can be an agency.</p>
          ) : null}
          {agencyResults.length > 0 ? (
            <ul className="space-y-2">
              {agencyResults.map((a) => (
                <li key={a.id}>
                  <form action={setManagedByAction}>
                    <input type="hidden" name="customerId" value={customerId} />
                    <input type="hidden" name="agencyId" value={a.id} />
                    <button type="submit" className={secondaryButtonClass}>
                      Managed by {a.displayName} ({formatCustomerNumber(a.number)})
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {managesComplexes ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-charcoal">Complexes managed</h3>
          <ul className="divide-y divide-charcoal/10 rounded-xl ring-1 ring-charcoal/10">
            {hierarchy.complexes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm">
                <Link href={`/customers/${c.id}`} className="min-w-0 break-words font-semibold text-forest underline">
                  {c.displayName}
                </Link>
                <span className="text-charcoal/60">
                  {formatCustomerNumber(c.number)} · {c.status.toLowerCase()} · {c.propertyCount}{" "}
                  {c.propertyCount === 1 ? "property" : "properties"} · {c.quoteCount}{" "}
                  {c.quoteCount === 1 ? "quote" : "quotes"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 5: Wire the panel into the customer page**

`apps/admin/src/app/(staff)/customers/[id]/page.tsx`:
- add `getCustomerHierarchy` and `searchAgencies` to the `@ace/core` import;
- change `type Search` to `type Search = { tab?: Param; edit?: Param; add?: Param; error?: Param; agencyQ?: Param; link?: Param };`;
- after `const notice = first(sp.error);` add:

```ts
  const agencyQuery = (first(sp.agencyQ) ?? "").slice(0, 80);
  const linkNotice = first(sp.link);
```

- replace the `<OverviewTab ... />` element with:

```tsx
          <OverviewTab
            customer={customer}
            editing={edit === "1"}
            isOwner={staff.role === "OWNER"}
            hierarchy={await getCustomerHierarchy(getDb(), actor, id)}
            agencyQuery={agencyQuery}
            agencyResults={
              agencyQuery ? await searchAgencies(getDb(), actor, { q: agencyQuery, excludeId: id }) : []
            }
            linkNotice={linkNotice}
          />
```

`apps/admin/src/app/(staff)/customers/[id]/overview-tab.tsx`:
- change the first import to `import { formatCustomerNumber, type AgencyOption, type CustomerHierarchy, type getCustomer } from "@ace/core";` and add `import { HierarchyPanel } from "./hierarchy-panel";`;
- change the props of `OverviewTab` to:

```tsx
export function OverviewTab({
  customer: c,
  editing,
  isOwner,
  hierarchy,
  agencyQuery,
  agencyResults,
  linkNotice,
}: {
  customer: Customer;
  editing: boolean;
  isOwner: boolean;
  hierarchy: CustomerHierarchy;
  agencyQuery: string;
  agencyResults: AgencyOption[];
  linkNotice: string | undefined;
}) {
```

- directly after the closing `</dl>`, add:

```tsx
      <HierarchyPanel
        customerId={c.id}
        locked={Boolean(c.anonymisedAt)}
        hierarchy={hierarchy}
        agencyQuery={agencyQuery}
        agencyResults={agencyResults}
        notice={linkNotice}
      />
```

`apps/admin/src/app/(staff)/customers/[id]/owner-tools.tsx`: change the warning sentence to `<strong>Anonymise</strong> permanently removes names, phone numbers, emails, addresses, notes and access details, and ends their client portal sign-ins. A customer that still manages complexes cannot be anonymised. The customer number and money amounts stay so old invoices still add up. <strong>This cannot be undone.</strong>` (keep the JSX structure; only the words change).

- [ ] **Step 6: The Portal panel on each contact** (replace `apps/admin/src/app/(staff)/customers/[id]/contacts-tab.tsx` with)

```tsx
import { PORTAL_ACCESS_MESSAGES, type getCustomer } from "@ace/core";
import Link from "next/link";
import { secondaryButtonClass } from "@/components/form";
import { formatDate } from "@/lib/format";
import { inviteContactAction, removeContactAccessAction, removeContactAction } from "../actions";
import { ContactForm, type ContactRow } from "./contact-form";

type Customer = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;
type Contact = Customer["contacts"][number];

/** The address bar only carries a fixed code; nothing else from the URL is ever shown. */
const NOTICES: Record<string, { text: string; tone: "error" | "good" | "warn" }> = {
  "last-contact": { text: "A customer needs at least one contact.", tone: "error" },
  generic: { text: "Could not remove that contact.", tone: "error" },
  invited: { text: "Portal access given and the welcome email sent.", tone: "good" },
  "invite-failed": {
    text: "Portal access given, but the welcome email could not be sent. Try Invite to portal again later.",
    tone: "warn",
  },
  removed: { text: "Portal access removed for this contact.", tone: "good" },
  "no-email": { text: PORTAL_ACCESS_MESSAGES.noEmail, tone: "error" },
  archived: { text: PORTAL_ACCESS_MESSAGES.archived, tone: "error" },
  "portal-generic": { text: "That could not be done. Refresh the page and try again.", tone: "error" },
};

const TONES = {
  error: "bg-red-50 text-red-800 ring-red-200",
  good: "bg-forest/10 text-forest ring-forest/25",
  warn: "bg-ochre/10 text-charcoal ring-ochre/30",
} as const;

/** Only these fields cross to the browser. */
function toRow(c: Contact): ContactRow {
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    email: c.email,
    phone: c.phone,
    receivesQuotes: c.receivesQuotes,
    receivesInvoices: c.receivesInvoices,
  };
}

function portalLine(c: Contact): string {
  const parts = [c.portalAccess ? "Portal: on" : "Portal: off"];
  if (c.portalInvitedAt) parts.push(`invited ${formatDate(c.portalInvitedAt)}`);
  if (c.portalWelcomedAt) parts.push(`welcomed ${formatDate(c.portalWelcomedAt)}`);
  if (c.lastSignedInAt) parts.push(`last signed in ${formatDate(c.lastSignedInAt)}`);
  return parts.join(" · ");
}

function PortalControls({ customerId, c }: { customerId: string; c: Contact }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {c.email ? (
        <form action={inviteContactAction}>
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="contactId" value={c.id} />
          <button type="submit" className={secondaryButtonClass} aria-label={`Invite ${c.name} to the portal`}>
            {c.portalAccess ? "Send the welcome again" : "Invite to portal"}
          </button>
        </form>
      ) : null}
      {c.portalAccess ? (
        <details className="rounded-lg ring-1 ring-charcoal/10">
          <summary className="min-h-10 cursor-pointer px-3 py-2 text-sm font-semibold text-charcoal">
            Remove access
          </summary>
          <form action={removeContactAccessAction} className="space-y-2 px-3 pb-3">
            <p className="text-sm text-charcoal/70">
              They can no longer sign in to the portal, and their sign-ins end at once.
            </p>
            <input type="hidden" name="customerId" value={customerId} />
            <input type="hidden" name="contactId" value={c.id} />
            <button type="submit" className={secondaryButtonClass}>
              Yes, remove portal access
            </button>
          </form>
        </details>
      ) : null}
    </div>
  );
}

export function ContactsTab({
  customer,
  edit,
  add,
  notice,
}: {
  customer: Customer;
  edit?: string | undefined;
  add: boolean;
  notice?: string | undefined;
}) {
  const locked = Boolean(customer.anonymisedAt);
  const message = notice && Object.hasOwn(NOTICES, notice) ? NOTICES[notice] : undefined;
  const editing = locked ? undefined : customer.contacts.find((c) => c.id === edit);

  if (add && !locked) return <ContactForm customerId={customer.id} />;
  if (editing) return <ContactForm customerId={customer.id} contact={toRow(editing)} />;

  return (
    <div className="space-y-4">
      {message ? (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`rounded-lg px-3 py-2 text-sm ring-1 ${TONES[message.tone]}`}
        >
          {message.text}
        </p>
      ) : null}
      <ul className="divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
        {customer.contacts.map((c) => (
          <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-semibold text-forest">
                {c.name}
                {c.role ? <span className="ml-2 text-sm font-normal text-charcoal/60">{c.role}</span> : null}
              </p>
              <p className="break-words text-sm text-charcoal/70">
                {[c.email, c.phone].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-1 text-xs text-charcoal/50">
                {[c.receivesQuotes && "quotes", c.receivesInvoices && "invoices"].filter(Boolean).join(" · ") ||
                  "no messages"}
              </p>
              <p className="mt-1 text-xs text-charcoal/60">{portalLine(c)}</p>
              {locked ? null : <PortalControls customerId={customer.id} c={c} />}
            </div>
            {locked ? null : (
              <div className="flex gap-2">
                <Link
                  href={`/customers/${customer.id}?tab=contacts&edit=${c.id}`}
                  className={secondaryButtonClass}
                  aria-label={`Edit ${c.name}`}
                >
                  Edit
                </Link>
                <form action={removeContactAction}>
                  <input type="hidden" name="customerId" value={customer.id} />
                  <input type="hidden" name="contactId" value={c.id} />
                  <button type="submit" className={secondaryButtonClass} aria-label={`Remove ${c.name}`}>
                    Remove
                  </button>
                </form>
              </div>
            )}
          </li>
        ))}
      </ul>
      {locked ? null : (
        <Link href={`/customers/${customer.id}?tab=contacts&add=1`} className={secondaryButtonClass}>
          Add contact
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Activity labels and quote facts**

`apps/admin/src/app/(staff)/customers/[id]/activity-tab.tsx`: add to `label`:

```ts
  "customer.manager_set": "Linked to a managing agency",
  "customer.manager_cleared": "Managing agency removed",
  "customer.complex_added": "Complex linked to this agency",
  "customer.complex_removed": "Complex unlinked from this agency",
  "customer.bills_to_changed": "Billing recipient changed",
  "customer.portal_invited": "Invited to the client portal",
  "customer.portal_access_granted": "Given portal access after an acceptance",
  "customer.portal_access_removed": "Portal access removed",
  "customer.portal_welcomed": "Completed the portal welcome",
  "portal.invite_sent": "Portal welcome email sent",
  "portal.invite_failed": "Portal welcome email could not be sent",
```

`apps/admin/src/app/(staff)/quotes/[id]/quote-facts.tsx`:
- after `const onLink = quote.acceptedMethod === "CLIENT_LINK";` add:

```ts
  const inPortal = quote.acceptedMethod === "CLIENT_PORTAL";
  const contact = quote.acceptedByContact;
  const forAgency = contact && contact.customerId !== quote.customerId ? contact.customer.displayName : null;
```

- replace the content of the `accepted` row (the expression after `{formatDateTime(quote.acceptedAt)}`) with:

```tsx
        {inPortal
          ? ` in the client portal by ${contact?.name ?? quote.acceptedByName ?? "the client"}${forAgency ? ` (for agency ${forAgency})` : ""}`
          : onLink
            ? ` on the client link by ${quote.acceptedByName ?? "the client"}`
            : `${quote.acceptedMethod ? ` (${ACCEPT_METHOD_LABELS[quote.acceptedMethod]})` : ""}${quote.acceptedByName ? ` by ${quote.acceptedByName}` : ""}`}
```

- directly after that row is pushed, add:

```tsx
    if (inPortal && quote.acceptedByName && quote.acceptedByName !== contact?.name) {
      rows.push(
        <Row key="typed" label="Name typed on acceptance">
          {quote.acceptedByName}
        </Row>,
      );
    }
```

- change `if (onLink && (customerStatus === "PAUSED" || customerStatus === "ARCHIVED"))` to `if ((onLink || inPortal) && (customerStatus === "PAUSED" || customerStatus === "ARCHIVED"))`;
- in the declined row change `" by the client on the link"` to `" by the client online"` (a portal decline also sets `declinedByClient`).

- [ ] **Step 8: Check, look, commit**

```bash
npx prettier --write packages/core/src/quotes/drafts.ts packages/core/src/quotes/activity.ts packages/core/src/customers/customers.ts packages/core/src/portal/staff-views.db.test.ts "apps/admin/src/app/(staff)/customers/actions.ts" "apps/admin/src/app/(staff)/customers/[id]" "apps/admin/src/app/(staff)/quotes/[id]/quote-facts.tsx"
npm run typecheck
npm run lint
npm run test
git add packages/core/src/quotes/drafts.ts packages/core/src/quotes/activity.ts packages/core/src/customers/customers.ts packages/core/src/portal/staff-views.db.test.ts "apps/admin/src/app/(staff)/customers/actions.ts" "apps/admin/src/app/(staff)/customers/[id]/page.tsx" "apps/admin/src/app/(staff)/customers/[id]/overview-tab.tsx" "apps/admin/src/app/(staff)/customers/[id]/hierarchy-panel.tsx" "apps/admin/src/app/(staff)/customers/[id]/contacts-tab.tsx" "apps/admin/src/app/(staff)/customers/[id]/activity-tab.tsx" "apps/admin/src/app/(staff)/customers/[id]/owner-tools.tsx" "apps/admin/src/app/(staff)/quotes/[id]/quote-facts.tsx"
git commit -m "Add the staff managing-agency panel, the contact Portal panel and the portal quote facts

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: all pass (the existing `activity.db.test.ts` expectation "Client (private link)" still holds for a link acceptance). Then start `npm run dev:admin`, open a made-up customer's Overview and Contacts tabs at 375px width and confirm the Managing agency panel and the Portal line show with no sideways scroll. Stop the server.

---

### Task 14: Documentation and the settings template

**Files:**
- Modify: `.env.example`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/superpowers/specs/2026-11-23-client-portal-design.md` (status line only)

- [ ] **Step 1: `.env.example`**: replace the email block with:

```
# ---------- Email (Resend) ----------
# Sign-in codes and portal welcome emails. LIVE: create the key in Resend after verifying the
# acegardens.co.za domain (DNS records), and set both values in the hosting dashboard (never in git).
# In development, leave RESEND_API_KEY empty: emails are printed to the dev server console instead
# (that is where you read the sign-in code). In production a missing key makes sending fail.
RESEND_API_KEY=
EMAIL_FROM="ACE Garden Services <noreply@acegardens.co.za>"
```

and under "Where each app lives" add the comment line above `PORTAL_URL`: `# Used by both apps: the staff app builds client links from it, both apps put it in the welcome email. Required in production.`

- [ ] **Step 2: `docs/ARCHITECTURE.md`**
- In the roadmap table, change row 4's "Delivers" cell to `Built: sign-in by emailed code, welcome page, quotes with accept/decline, My complexes for agencies` (keep the table aligned).
- Add a new section after "Quotes: the private client link (Module 3b)" (before "Working agreement"):

```markdown
## Client portal, sign-in and managing agencies (Module 4)

- **Where the code lives.** `packages/core/src/portal/`. Portal-facing functions (sign-in, session,
  welcome, quotes, home) take a `PortalScope`, never a staff `Actor`, and are exported only from
  `@ace/core/portal`. Staff functions (managing-agency links, Invite to portal, Remove access) take
  `(store, actor, ...)`, check the role first and are exported from `@ace/core`. The portal pages are
  `apps/portal/src/app/{sign-in,welcome,quotes}` and the home page; the accept and decline forms are shared
  with the private link page (`apps/portal/src/components/quote-forms`).
- **Sign-in.** An emailed 6-digit code (10 minutes, single use, salted hash, 5 wrong tries kill it), then
  a session cookie (`__Host-ace-portal`) whose random value is stored only as a SHA-256 hash; 30 days
  sliding, 90 days at most. Code requests are limited to 3 per email and 10 per visitor per hour (hashed
  values in the rate-limit table). The reply never says whether an email is on file. Not Supabase Auth:
  client logins are completely separate from staff accounts.
- **The visible set.** Every request recomputes, from live data, the contacts with that email and portal
  access (customer not archived or anonymised), their customers, and the customers those manage (one
  level). Every query is restricted to it. Removing access, archiving or anonymising ends a session at
  once; moving a complex to another agency moves its visibility at once.
- **Managing agencies.** A complex is its own customer with an optional Managed by link to its agency
  and a Bills go to switch. One level only; an agency that still manages complexes cannot be anonymised.
- **Access.** After any acceptance commits (staff, link or portal), the quote customer's contacts who
  receive quotes and have an email, and were never invited, get access and a welcome email (sent with
  `after()`; an email failure never undoes the acceptance). Staff can Invite (re-send) and Remove access.
  A removed contact is never re-granted automatically.
- **Email.** `sendEmail` posts to Resend's HTTP API (no extra package). Without a key: printed to the dev
  console in development, a loud failure in production.
- **The portal's database login** gained exactly the columns these functions need (migration
  `20261123120000_client_portal`); it still cannot read property access notes, staff, services, wording,
  settings or the audit history. The exact list is frozen by `portal-role.db.test.ts`.

### Known limitations and follow-ups

- No alert to staff when a client signs in or accepts; staff look at the Quotes list and "last signed in"
  on the contact.
- Anyone who controls the inbox can sign in; there is no second factor for clients, by design.
- An agency's acceptance on behalf of a complex records the person and the agency; the complex's own
  contacts are not told.
- One level of hierarchy only.
- Over the page view limit nothing changes for signed-in pages (only the PDF route is rate limited, with
  a real 429); sign-in pages show their own "too many requests" message.

### Before real customer data goes in

- [ ] Set up Resend for `acegardens.co.za` (DNS records), then put `RESEND_API_KEY` and `EMAIL_FROM` in
      the hosting settings for BOTH apps (the staff app sends the welcome on Invite to portal).
- [ ] Set `PORTAL_URL` for both apps (the welcome email links to `<PORTAL_URL>/sign-in`).
- [ ] The Module 3b items still apply: the `ace_portal` login password and `PORTAL_DATABASE_URL`, and the
      `x-forwarded-for` check on the live host.
```

- [ ] **Step 3: Spec status line**: change line 3 of the spec to:
`Status: Implemented, browser check pending (branch module-4-client-portal). Design approved by the owner in three parts (2026-11-23).`

- [ ] **Step 4: Check and commit**

```bash
npx prettier --write docs/ARCHITECTURE.md
git add .env.example docs/ARCHITECTURE.md docs/superpowers/specs/2026-11-23-client-portal-design.md
git commit -m "Document the client portal, sign-in, managing agencies and the go-live steps

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Controller verification (not an implementer task)

- [ ] **Migration gate.** Task 2 was done with the owner's explicit yes, and nothing else applied a migration.
- [ ] **Full checks:** `npm run db:generate`, `npm run typecheck`, `npm run lint`, `npm run test`, then `npm run test:db` (about 10 minutes, dev database, rolled back). Every test passes, including the frozen `EXPECTED_PORTAL_GRANTS` catalogue. Then `npm run build` with no dev server running.
- [ ] **Real browser, both apps** (`npm run dev:admin` and `npm run dev:portal` in Git Bash; made-up data only, names like "ZZ E2E Agency", emails `@example.com`; no `RESEND_API_KEY`, so emails print to the portal or admin dev server console):
  1. Staff: create "ZZ E2E Agency" and two complexes "ZZ E2E Complex A/B" (each with a property and a contact who receives quotes), link both complexes to the agency (Managed by), switch Bills go to on one, see "Complexes managed" on the agency. Try a chain (link the agency to a complex): refused with the plain message.
  2. Staff: Invite to portal on the agency contact; the welcome email (with the sign-in link, no secret) prints in the admin console; the Portal line shows "invited".
  3. Portal at 375px: `/sign-in` with the agency email; the code prints in the portal console; wrong code once (message), then the right one; lands on `/welcome`; complete it (consent required); lands on My complexes with both complexes; search by complex name.
  4. Unknown email on `/sign-in`: the same next page and words; no code printed.
  5. Issue a quote for Complex A (staff), open it in the portal as the agency, accept with an add-on: staff quote page shows "Accepted in the client portal by ... (for agency ZZ E2E Agency)" and history "Client (portal)"; Complex A's quote contact gets access automatically and a welcome prints.
  6. Decline another quote in the portal; staff facts show "by the client online".
  7. Trustee: sign in as Complex B's contact (invite first): sees only Complex B; opening Complex A's quote address (`/quotes/<id>`) shows "This quote is not available".
  8. Remove access (staff) for a signed-in person: their next page load goes to `/sign-in`. Sign out works and the back button does not show a signed-in page.
  9. Rate limit: request codes 4 times for one email within an hour: the 4th shows "Too many code requests". PDF route: `/quotes/<id>/pdf` works signed in; signed out answers 404.
  10. Headers (browser dev tools or `curl -I`): `/`, `/welcome`, `/sign-in`, `/quotes/<id>` send `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow`; `/q/<code>` still sends `Referrer-Policy: no-referrer`; static assets under `/_next/static` keep their own caching.
  11. Every page above at 375px: no sideways scroll, buttons at least 40px high.
  12. A link preview user agent (for example `curl -A "WhatsApp/2.23"`) on `/sign-in` gets the plain page and cannot request a code.
- [ ] **One real accept through the actual `ace_portal` login.** Ask the owner's permission first (it means giving the role a temporary password in the dev database). With a yes: the owner runs `ALTER ROLE ace_portal WITH LOGIN PASSWORD '<temporary>'` themselves, sets `PORTAL_DATABASE_URL` in `.env.local`, restart the portal, sign in and accept one made-up quote, confirm it worked; then the owner runs `ALTER ROLE ace_portal WITH NOLOGIN`, remove `PORTAL_DATABASE_URL` from `.env.local`, and confirm `rolcanlogin` is false again.
- [ ] **Clean up** the made-up data created in the browser ("ZZ E2E ..." customers: archive them, or anonymise with the owner's agreement; delete their sign-in rows with a throwaway script if any remain).
- [ ] Final whole-branch review, then tell the owner in plain words what was built, what was decided on their behalf (the "Decisions taken in this plan" list), and the go-live checklist.
