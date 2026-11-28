-- Company profile (addendum to Module 5): the company's own physical address, and the company logo.
-- Adds columns and one new table only. No existing data is changed or removed, and no rows are inserted
-- (no logo row means no logo). Existing organisation_settings rows get empty address columns.

-- AlterTable
ALTER TABLE "organisation_settings" ADD COLUMN     "addressCity" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "addressLine1" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "addressLine2" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "addressPostalCode" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "addressSuburb" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "company_logo" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "data" BYTEA NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "company_logo_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Protections (same rules as the earlier migrations)
-- ---------------------------------------------------------------------------
ALTER TABLE "company_logo" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "company_logo" FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- At most one row; only PNG or JPEG (what the PDF library can draw); at most 500 KB (524288 bytes).
ALTER TABLE "company_logo"
  ADD CONSTRAINT "company_logo_singleton" CHECK ("id" = 'singleton');
ALTER TABLE "company_logo"
  ADD CONSTRAINT "company_logo_content_type" CHECK ("contentType" IN ('image/png', 'image/jpeg'));
ALTER TABLE "company_logo"
  ADD CONSTRAINT "company_logo_size_range" CHECK ("byteSize" > 0 AND "byteSize" <= 524288);

-- ---------------------------------------------------------------------------
-- The ace_portal role may only READ the logo (quote PDFs are made by the portal app for clients). It gets no
-- grant on organisation_settings: the company address is frozen into each quote's wording and each invoice, so
-- the portal never reads it live. Frozen by portal-role.db.test.ts.
-- ---------------------------------------------------------------------------
GRANT SELECT ("id", "data", "contentType", "byteSize", "updatedAt") ON "company_logo" TO "ace_portal";

CREATE POLICY "ace_portal_access" ON "company_logo" AS PERMISSIVE FOR SELECT TO "ace_portal" USING (true);
