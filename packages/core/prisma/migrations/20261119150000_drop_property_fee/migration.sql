ALTER TABLE "properties" DROP CONSTRAINT IF EXISTS "properties_fee_not_negative";

-- AlterTable
ALTER TABLE "properties" DROP COLUMN "agreedMonthlyFeeCents",
DROP COLUMN "extrasNote";
