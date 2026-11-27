-- CreateEnum
CREATE TYPE "BillingTiming" AS ENUM ('PRE', 'POST');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('MONTHLY', 'ONCE_OFF');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'VOID');

-- CreateEnum
CREATE TYPE "InvoiceLineKind" AS ENUM ('SERVICE', 'OPTIONAL', 'LATE_FEE', 'ADJUSTMENT', 'ONCE_OFF');

-- CreateEnum
CREATE TYPE "InvoiceEmailStatus" AS ENUM ('NONE', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentReportStatus" AS ENUM ('WAITING', 'CONFIRMED', 'DISMISSED');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "billingTiming" "BillingTiming" NOT NULL DEFAULT 'PRE';

-- CreateTable
CREATE TABLE "invoice_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "bankName" TEXT NOT NULL DEFAULT '',
    "accountHolder" TEXT NOT NULL DEFAULT '',
    "accountNumber" TEXT NOT NULL DEFAULT '',
    "branchCode" TEXT NOT NULL DEFAULT '',
    "accountType" TEXT NOT NULL DEFAULT '',
    "onceOffDueDays" INTEGER NOT NULL DEFAULT 14,
    "lateFeeCents" INTEGER NOT NULL DEFAULT 10000,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "invoice_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_counters" (
    "year" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "billToCustomerId" UUID NOT NULL,
    "kind" "InvoiceKind" NOT NULL,
    "serviceMonth" DATE,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "numberYear" INTEGER,
    "numberSeq" INTEGER,
    "dueDate" DATE,
    "issuedAt" TIMESTAMP(3),
    "issuedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "draftVersion" INTEGER NOT NULL DEFAULT 1,
    "sourceQuoteId" UUID,
    "totalCents" INTEGER,
    "recipientName" TEXT,
    "recipientAddress" TEXT,
    "bankSnapshot" JSONB,
    "contentHash" TEXT,
    "emailStatus" "InvoiceEmailStatus" NOT NULL DEFAULT 'NONE',
    "emailedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedById" TEXT,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "propertyId" UUID,
    "kind" "InvoiceLineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "sourceQuoteLineId" UUID,
    "forInvoiceId" UUID,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "payerCustomerId" UUID NOT NULL,
    "receivedOn" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedById" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reports" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "reportedByContactId" UUID,
    "paidOn" DATE NOT NULL,
    "reference" TEXT,
    "status" "PaymentReportStatus" NOT NULL DEFAULT 'WAITING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "payment_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_customerId_idx" ON "invoices"("customerId");

-- CreateIndex
CREATE INDEX "invoices_billToCustomerId_idx" ON "invoices"("billToCustomerId");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_numberYear_numberSeq_key" ON "invoices"("numberYear", "numberSeq");

-- CreateIndex
CREATE INDEX "invoice_lines_invoiceId_idx" ON "invoice_lines"("invoiceId");

-- CreateIndex
CREATE INDEX "invoice_lines_forInvoiceId_idx" ON "invoice_lines"("forInvoiceId");

-- CreateIndex
CREATE INDEX "payments_payerCustomerId_idx" ON "payments"("payerCustomerId");

-- CreateIndex
CREATE INDEX "payment_allocations_invoiceId_idx" ON "payment_allocations"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_paymentId_invoiceId_key" ON "payment_allocations"("paymentId", "invoiceId");

-- CreateIndex
CREATE INDEX "payment_reports_invoiceId_idx" ON "payment_reports"("invoiceId");

-- CreateIndex
CREATE INDEX "payment_reports_status_idx" ON "payment_reports"("status");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_billToCustomerId_fkey" FOREIGN KEY ("billToCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sourceQuoteId_fkey" FOREIGN KEY ("sourceQuoteId") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_sourceQuoteLineId_fkey" FOREIGN KEY ("sourceQuoteLineId") REFERENCES "quote_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_forInvoiceId_fkey" FOREIGN KEY ("forInvoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payerCustomerId_fkey" FOREIGN KEY ("payerCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_reportedByContactId_fkey" FOREIGN KEY ("reportedByContactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Protections (same rules as the earlier migrations). No rights for ace_portal here: the 5b migration
-- adds exactly the columns the portal needs, frozen by portal-role.db.test.ts.
-- ---------------------------------------------------------------------------
ALTER TABLE "invoice_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_reports" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "invoice_settings", "invoice_counters", "invoices", "invoice_lines", "payments", "payment_allocations", "payment_reports" FROM %I', r);
    END IF;
  END LOOP;
END $$;

ALTER TABLE "invoice_settings"
  ADD CONSTRAINT "invoice_settings_singleton" CHECK ("id" = 'singleton');
ALTER TABLE "invoice_settings"
  ADD CONSTRAINT "invoice_settings_due_days_range" CHECK ("onceOffDueDays" BETWEEN 0 AND 90);
ALTER TABLE "invoice_settings"
  ADD CONSTRAINT "invoice_settings_late_fee_range" CHECK ("lateFeeCents" BETWEEN 0 AND 10000000);

ALTER TABLE "invoice_counters"
  ADD CONSTRAINT "invoice_counters_seq_positive" CHECK ("lastSeq" >= 1);

-- A draft has no number; an issued or void invoice has one, plus its due date, issue date and total.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_number_iff_not_draft"
  CHECK (("status" = 'DRAFT') = ("numberYear" IS NULL AND "numberSeq" IS NULL));
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_number_pair" CHECK (("numberYear" IS NULL) = ("numberSeq" IS NULL));
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_issued_complete"
  CHECK ("status" = 'DRAFT' OR ("dueDate" IS NOT NULL AND "issuedAt" IS NOT NULL AND "totalCents" IS NOT NULL));
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_total_positive" CHECK ("totalCents" IS NULL OR "totalCents" > 0);
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_service_month_iff_monthly" CHECK (("kind" = 'MONTHLY') = ("serviceMonth" IS NOT NULL));
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_service_month_first_day"
  CHECK ("serviceMonth" IS NULL OR EXTRACT(DAY FROM "serviceMonth") = 1);
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_void_iff_voided" CHECK (("status" = 'VOID') = ("voidedAt" IS NOT NULL));
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_draft_version_positive" CHECK ("draftVersion" >= 1);

-- The monthly run is idempotent: one live (draft or issued) monthly invoice per customer and service month.
CREATE UNIQUE INDEX "invoices_monthly_once_per_month" ON "invoices" ("customerId", "serviceMonth")
  WHERE "kind" = 'MONTHLY' AND "status" <> 'VOID';

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_amount_not_zero" CHECK ("amountCents" <> 0);
ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_negative_only_adjustment" CHECK ("amountCents" > 0 OR "kind" = 'ADJUSTMENT');
ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_late_fee_target" CHECK ("kind" <> 'LATE_FEE' OR "forInvoiceId" IS NOT NULL);
ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_description_length" CHECK (char_length("description") BETWEEN 1 AND 300);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amountCents" > 0);
ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "payment_allocations_amount_positive" CHECK ("amountCents" > 0);
ALTER TABLE "payment_reports"
  ADD CONSTRAINT "payment_reports_resolved_iff_not_waiting" CHECK (("status" = 'WAITING') = ("resolvedAt" IS NULL));

-- ---------------------------------------------------------------------------
-- The settings row (bank details are entered by the owner in the app before the first issue)
-- ---------------------------------------------------------------------------
INSERT INTO "invoice_settings" ("id", "onceOffDueDays", "lateFeeCents", "updatedAt")
VALUES ('singleton', 14, 10000, CURRENT_TIMESTAMP);
