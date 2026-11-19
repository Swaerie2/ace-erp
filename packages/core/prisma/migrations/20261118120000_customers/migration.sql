-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('PERSON', 'COMPANY');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('LEAD', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CustomerSource" AS ENUM ('REFERRAL', 'GOOGLE', 'FACEBOOK', 'DIRECTORY', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceFrequency" AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'ONCE_OFF');

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "type" "CustomerType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "companyName" TEXT,
    "registrationNumber" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusBeforeArchive" "CustomerStatus",
    "billingLine1" TEXT,
    "billingLine2" TEXT,
    "billingSuburb" TEXT,
    "billingCity" TEXT,
    "billingPostalCode" TEXT,
    "source" "CustomerSource",
    "sourceNote" TEXT,
    "notes" TEXT,
    "consentAt" TIMESTAMP(3),
    "consentSource" TEXT,
    "consentNote" TEXT,
    "archivedAt" TIMESTAMP(3),
    "anonymisedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "receivesQuotes" BOOLEAN NOT NULL DEFAULT true,
    "receivesInvoices" BOOLEAN NOT NULL DEFAULT true,
    "portalAccess" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "suburb" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "mapUrl" TEXT,
    "accessNotes" TEXT,
    "lawnSizeSqm" INTEGER,
    "grassType" TEXT,
    "hasIrrigation" BOOLEAN NOT NULL DEFAULT false,
    "terrainNotes" TEXT,
    "frequency" "ServiceFrequency",
    "preferredDay" TEXT,
    "agreedMonthlyFeeCents" INTEGER,
    "extrasNote" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_number_key" ON "customers"("number");

-- CreateIndex
CREATE INDEX "customers_displayName_idx" ON "customers"("displayName");

-- CreateIndex
CREATE INDEX "customers_status_idx" ON "customers"("status");

-- CreateIndex
CREATE INDEX "contacts_customerId_idx" ON "contacts"("customerId");

-- CreateIndex
CREATE INDEX "contacts_email_idx" ON "contacts"("email");

-- CreateIndex
CREATE INDEX "contacts_phone_idx" ON "contacts"("phone");

-- CreateIndex
CREATE INDEX "properties_customerId_idx" ON "properties"("customerId");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Protections (same rules as the init migration)
-- ---------------------------------------------------------------------------
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "customers", "contacts", "properties" FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE "customers_number_seq" FROM %I', r);
    END IF;
  END LOOP;
END $$;

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_display_name_not_blank" CHECK (length(btrim("displayName")) > 0);
ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_email_lowercase" CHECK ("email" IS NULL OR "email" = lower("email"));
ALTER TABLE "properties"
  ADD CONSTRAINT "properties_fee_not_negative"
  CHECK ("agreedMonthlyFeeCents" IS NULL OR "agreedMonthlyFeeCents" >= 0);
ALTER TABLE "properties"
  ADD CONSTRAINT "properties_lawn_not_negative"
  CHECK ("lawnSizeSqm" IS NULL OR "lawnSizeSqm" >= 0);
