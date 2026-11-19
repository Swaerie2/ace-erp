-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'ISSUED', 'ACCEPTED', 'DECLINED', 'REPLACED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "QuoteLineKind" AS ENUM ('PRICED', 'OPTIONAL', 'INCLUDED');

-- CreateEnum
CREATE TYPE "QuoteBilling" AS ENUM ('MONTHLY', 'ONCE_OFF');

-- CreateEnum
CREATE TYPE "QuoteFrequency" AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'AS_REQUIRED');

-- CreateEnum
CREATE TYPE "QuoteSentMethod" AS ENUM ('WHATSAPP', 'EMAIL', 'HAND', 'OTHER');

-- CreateEnum
CREATE TYPE "QuoteAcceptMethod" AS ENUM ('WHATSAPP', 'EMAIL', 'PHONE', 'IN_PERSON', 'SIGNED_COPY', 'CLIENT_LINK');

-- CreateTable
CREATE TABLE "quote_wording" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "tagline" TEXT NOT NULL,
    "standardExclusions" JSONB NOT NULL,
    "monthlyTerms" JSONB NOT NULL,
    "onceOffTerms" JSONB NOT NULL,
    "commonTerms" JSONB NOT NULL,
    "everyVisitPoints" JSONB NOT NULL,
    "defaultValidityDays" INTEGER NOT NULL DEFAULT 30,
    "registrationNumber" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_wording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "numberYear" INTEGER,
    "numberSeq" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "revisionOfId" UUID,
    "draftVersion" INTEGER NOT NULL DEFAULT 1,
    "validUntil" DATE NOT NULL,
    "internalNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "issuedById" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentMethod" "QuoteSentMethod",
    "recipientName" TEXT,
    "recipientEmail" TEXT,
    "recipientPhone" TEXT,
    "siteLabel" TEXT,
    "siteAddress" TEXT,
    "wordingSnapshot" JSONB,
    "contentHash" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptedMethod" "QuoteAcceptMethod",
    "acceptedByName" TEXT,
    "acceptedStartDate" DATE,
    "acceptanceNote" TEXT,
    "acceptedByStaffId" TEXT,
    "acceptedIp" TEXT,
    "acceptedUserAgent" TEXT,
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "reversalNote" TEXT,
    "agreementEndedAt" TIMESTAMP(3),
    "agreementReplacedById" UUID,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_scope_items" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "ServiceKind" NOT NULL,

    CONSTRAINT "quote_scope_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "lineKind" "QuoteLineKind" NOT NULL,
    "billing" "QuoteBilling",
    "frequency" "QuoteFrequency",
    "description" TEXT NOT NULL,
    "amountCents" INTEGER,
    "chosen" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_counters" (
    "year" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL,

    CONSTRAINT "quote_counters_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE INDEX "quotes_customerId_idx" ON "quotes"("customerId");

-- CreateIndex
CREATE INDEX "quotes_propertyId_idx" ON "quotes"("propertyId");

-- CreateIndex
CREATE INDEX "quotes_status_idx" ON "quotes"("status");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_numberYear_numberSeq_revision_key" ON "quotes"("numberYear", "numberSeq", "revision");

-- CreateIndex
CREATE INDEX "quote_scope_items_quoteId_idx" ON "quote_scope_items"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "quote_scope_items_quoteId_serviceId_key" ON "quote_scope_items"("quoteId", "serviceId");

-- CreateIndex
CREATE INDEX "quote_lines_quoteId_idx" ON "quote_lines"("quoteId");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_revisionOfId_fkey" FOREIGN KEY ("revisionOfId") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_scope_items" ADD CONSTRAINT "quote_scope_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_scope_items" ADD CONSTRAINT "quote_scope_items_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Protections (same rules as the earlier migrations)
-- ---------------------------------------------------------------------------
ALTER TABLE "quote_wording" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quote_scope_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quote_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quote_counters" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "quote_wording", "quotes", "quote_scope_items", "quote_lines", "quote_counters" FROM %I', r);
    END IF;
  END LOOP;
END $$;

ALTER TABLE "quote_wording"
  ADD CONSTRAINT "quote_wording_singleton" CHECK ("id" = 'singleton');
ALTER TABLE "quote_wording"
  ADD CONSTRAINT "quote_wording_validity_range" CHECK ("defaultValidityDays" BETWEEN 1 AND 365);

-- A draft has no number; everything else has one.
ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_number_iff_issued"
  CHECK (("status" = 'DRAFT') = ("numberYear" IS NULL AND "numberSeq" IS NULL));
ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_number_pair" CHECK (("numberYear" IS NULL) = ("numberSeq" IS NULL));
ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_revision_positive" CHECK ("revision" >= 1);

ALTER TABLE "quote_lines"
  ADD CONSTRAINT "quote_lines_amount_positive" CHECK ("amountCents" IS NULL OR "amountCents" > 0);
ALTER TABLE "quote_lines"
  ADD CONSTRAINT "quote_lines_included_free"
  CHECK ("lineKind" <> 'INCLUDED' OR ("amountCents" IS NULL AND "billing" IS NULL));

ALTER TABLE "quote_counters"
  ADD CONSTRAINT "quote_counters_seq_positive" CHECK ("lastSeq" >= 1);

-- ---------------------------------------------------------------------------
-- The standard wording (editable by the owner in the app afterwards)
-- ---------------------------------------------------------------------------
INSERT INTO "quote_wording"
  ("id", "tagline", "standardExclusions", "monthlyTerms", "onceOffTerms", "commonTerms",
   "everyVisitPoints", "defaultValidityDays", "registrationNumber", "phone", "email", "website",
   "updatedAt")
VALUES (
  'singleton',
  $t$We don't cut corners. We define them.$t$,
  $j$[
    "Tree work, landscaping and redesign.",
    "Plants, compost and fertiliser (supplied at cost on written approval).",
    "Other seasonal treatments: fertilising, scarifying, top-dressing and pest spraying."
  ]$j$::jsonb,
  $j$[
    {"heading": "Payment", "body": "Payable in advance on or before the 30th of each month."},
    {"heading": "Late payment", "body": "Accounts not settled by the 5th of the following month attract a R100.00 late payment fee."},
    {"heading": "Annual escalation", "body": "Service fees are reviewed annually each March; the projected escalation rate ranges between 6 and 8%."},
    {"heading": "Termination", "body": "Either party may terminate this agreement without cause on 30 (thirty) days' written notice. On termination, the Client's obligation is limited to payment for services rendered up to the termination date, plus one (1) month's notice period at the contracted rate."},
    {"heading": "Scheduled closures", "body": "In line with labour legislation, our teams take annual leave: two (2) weeks in July and one (1) week over the December/January festive season. Full monthly fees remain payable during these periods."}
  ]$j$::jsonb,
  $j$[
    {"heading": "Payment", "body": "Once-off work is payable before the work is completed."},
    {"heading": "Scope", "body": "Work outside the scope described in this quotation is quoted separately on request."}
  ]$j$::jsonb,
  $j$[
    {"heading": "Limitation of liability", "body": "In the event of accidental damage caused by ACE Garden Services, written notification must be submitted within 5 (five) working days of the incident. All claims will be directed to ACE Garden Services' insurer. No cash settlements will be made directly by ACE Garden Services. The Client's full cooperation is required; failure to cooperate may result in claims being delayed or declined by the insurer."},
    {"heading": "Force majeure", "body": "Neither party shall be held liable for delays or failure to perform obligations arising from causes beyond their reasonable control, including but not limited to natural disasters, severe weather events, or government-imposed restrictions."},
    {"heading": "Banking details", "body": "Banking details will be confirmed by way of an official bank account confirmation letter on acceptance of this quotation."}
  ]$j$::jsonb,
  $j$[
    "Your service is scheduled to a fixed day every week.",
    "Team clocks in and out with a GPS time stamp.",
    "Before and after photos on every visit.",
    "A service report is emailed to you after each visit.",
    "Branded ACE overalls and cap.",
    "Vetted staff with ACE ID.",
    "Same team every visit."
  ]$j$::jsonb,
  30,
  '2026/295342/07',
  '079 296 0578',
  'info@acegardens.co.za',
  'www.acegardens.co.za',
  CURRENT_TIMESTAMP
);
