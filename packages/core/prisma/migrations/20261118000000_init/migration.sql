-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'MANAGER', 'CREW');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('STAFF', 'CUSTOMER', 'SYSTEM');

-- CreateTable
CREATE TABLE "organisation_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "tradingName" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "vatEnabled" BOOLEAN NOT NULL DEFAULT false,
    "vatRateBps" INTEGER NOT NULL DEFAULT 0,
    "quotePrefix" TEXT NOT NULL DEFAULT 'Q',
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organisation_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_email_key" ON "staff_users"("email");

-- CreateIndex
CREATE INDEX "audit_log_entityType_entityId_idx" ON "audit_log"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_actorType_actorId_idx" ON "audit_log"("actorType", "actorId");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");


-- =====================================================================================
-- Hand-written hardening. Everything above is generated from schema.prisma.
-- =====================================================================================

-- 1. Business-rule constraints.
ALTER TABLE "organisation_settings"
  ADD CONSTRAINT "organisation_settings_singleton" CHECK ("id" = 'singleton');
ALTER TABLE "organisation_settings"
  ADD CONSTRAINT "organisation_settings_vat_rate_range" CHECK ("vatRateBps" >= 0 AND "vatRateBps" <= 10000);
ALTER TABLE "staff_users"
  ADD CONSTRAINT "staff_users_email_lowercase" CHECK ("email" = lower("email"));

-- 2. Private by default. Row Level Security on with NO policies means the database's public
--    API (used with the publishable key) can see nothing. Only our own server code can.
ALTER TABLE "organisation_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;

-- 3. Belt and braces: also strip the public API roles' privileges, now and for future tables.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
    END IF;
  END LOOP;
END
$$;

-- 4. The audit log can only be added to. Editing, deleting or emptying it is refused.
CREATE FUNCTION "audit_log_block_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
END;
$$;
REVOKE ALL ON FUNCTION "audit_log_block_change"() FROM PUBLIC;

CREATE TRIGGER "audit_log_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_block_change"();
CREATE TRIGGER "audit_log_no_truncate"
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_block_change"();

-- 5. The one settings row. These are business facts already public on the website.
--    VAT is off because ACE is not VAT registered.
INSERT INTO "organisation_settings" ("id", "tradingName", "legalName", "updatedAt")
VALUES ('singleton', 'ACE Garden Services', 'TERRA UNDECIM TRADING (PTY) LTD', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
