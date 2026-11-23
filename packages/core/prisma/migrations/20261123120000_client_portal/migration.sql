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
