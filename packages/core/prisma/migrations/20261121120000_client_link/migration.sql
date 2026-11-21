-- AlterTable
ALTER TABLE "quotes" ADD COLUMN "declinedByClient" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "firstViewedAt" TIMESTAMP(3),
ADD COLUMN "lastViewedAt" TIMESTAMP(3),
ADD COLUMN "linkCreatedAt" TIMESTAMP(3),
ADD COLUMN "linkToken" TEXT;

-- CreateTable
CREATE TABLE "public_link_hits" (
    "bucket" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "public_link_hits_pkey" PRIMARY KEY ("bucket","windowStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotes_linkToken_key" ON "quotes"("linkToken");

-- ---------------------------------------------------------------------------
-- Protections (same rules as the earlier migrations)
-- ---------------------------------------------------------------------------
ALTER TABLE "public_link_hits" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "public_link_hits" FROM %I', r);
    END IF;
  END LOOP;
END $$;

ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_link_token_length" CHECK ("linkToken" IS NULL OR length("linkToken") >= 40);
ALTER TABLE "public_link_hits"
  ADD CONSTRAINT "public_link_hits_count_positive" CHECK ("count" >= 1);

-- ---------------------------------------------------------------------------
-- The portal's own low-privilege database role. NOLOGIN: the owner turns it into a login at go-live by
-- setting a password in the database (never in git). It can reach only the columns the public client
-- link functions need. Row Level Security stays on; one policy per table lets only this role through
-- (the column grants below do the narrowing).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ace_portal') THEN
    CREATE ROLE "ace_portal" NOLOGIN;
  END IF;
END $$;

-- Lets the migration owner switch into the role, so the database tests can run the public functions
-- exactly as the portal will (SET LOCAL ROLE ace_portal). Membership grants no extra power to anyone else.
GRANT "ace_portal" TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO "ace_portal";

-- quotes: everything the client page, the PDF and the acceptance rules need. NOT internalNote,
-- reversalNote, staff ids, sentAt, sentMethod, draftVersion, recipientEmail, recipientPhone, createdAt.
GRANT SELECT (
  "id", "customerId", "propertyId", "status", "numberYear", "numberSeq", "revision", "revisionOfId",
  "validUntil", "issuedAt", "recipientName", "siteLabel", "siteAddress", "wordingSnapshot", "contentHash",
  "acceptedAt", "acceptedMethod", "acceptedByName", "acceptedStartDate", "declinedAt", "declineReason",
  "declinedByClient", "withdrawnAt", "agreementEndedAt", "agreementReplacedById", "linkToken",
  "firstViewedAt", "lastViewedAt"
) ON "quotes" TO "ace_portal";
GRANT UPDATE (
  "status", "acceptedAt", "acceptedMethod", "acceptedByName", "acceptedStartDate", "acceptanceNote",
  "acceptedByStaffId", "acceptedIp", "acceptedUserAgent", "declinedAt", "declineReason",
  "declinedByClient", "agreementEndedAt", "agreementReplacedById", "firstViewedAt", "lastViewedAt",
  "updatedAt"
) ON "quotes" TO "ace_portal";

GRANT SELECT ON "quote_lines" TO "ace_portal";
GRANT UPDATE ("chosen") ON "quote_lines" TO "ace_portal";
GRANT SELECT ON "quote_scope_items" TO "ace_portal";

GRANT SELECT ("id", "status", "anonymisedAt") ON "customers" TO "ace_portal";
GRANT UPDATE ("status", "updatedAt") ON "customers" TO "ace_portal";

GRANT SELECT ("id", "customerId", "archivedAt") ON "properties" TO "ace_portal";
GRANT UPDATE ("updatedAt") ON "properties" TO "ace_portal";

GRANT INSERT ON "audit_log" TO "ace_portal";
GRANT SELECT ("id") ON "audit_log" TO "ace_portal";

GRANT SELECT, INSERT, UPDATE, DELETE ON "public_link_hits" TO "ace_portal";

CREATE POLICY "ace_portal_access" ON "quotes" AS PERMISSIVE FOR ALL TO "ace_portal" USING (true) WITH CHECK (true);
CREATE POLICY "ace_portal_access" ON "quote_lines" AS PERMISSIVE FOR ALL TO "ace_portal" USING (true) WITH CHECK (true);
CREATE POLICY "ace_portal_access" ON "quote_scope_items" AS PERMISSIVE FOR ALL TO "ace_portal" USING (true) WITH CHECK (true);
CREATE POLICY "ace_portal_access" ON "customers" AS PERMISSIVE FOR ALL TO "ace_portal" USING (true) WITH CHECK (true);
CREATE POLICY "ace_portal_access" ON "properties" AS PERMISSIVE FOR ALL TO "ace_portal" USING (true) WITH CHECK (true);
CREATE POLICY "ace_portal_access" ON "audit_log" AS PERMISSIVE FOR ALL TO "ace_portal" USING (true) WITH CHECK (true);
CREATE POLICY "ace_portal_access" ON "public_link_hits" AS PERMISSIVE FOR ALL TO "ace_portal" USING (true) WITH CHECK (true);
