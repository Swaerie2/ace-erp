-- CreateEnum
CREATE TYPE "ServiceKind" AS ENUM ('CORE', 'OPTIONAL_EXTRA');

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "ServiceKind" NOT NULL DEFAULT 'CORE',
    "sortOrder" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "services_sortOrder_idx" ON "services"("sortOrder");



-- ---------------------------------------------------------------------------
-- Protections (same rules as the earlier migrations)
-- ---------------------------------------------------------------------------
ALTER TABLE "services" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "services" FROM %I', r);
    END IF;
  END LOOP;
END $$;

ALTER TABLE "services"
  ADD CONSTRAINT "services_name_not_blank" CHECK (length(btrim("name")) > 0);
ALTER TABLE "services"
  ADD CONSTRAINT "services_description_not_blank" CHECK (length(btrim("description")) > 0);

-- One name per service, ignoring upper/lower case (switched-off services count too).
-- Prisma cannot express this index, so it is only here (like the CHECK constraints above).
CREATE UNIQUE INDEX "services_name_lower_key" ON "services" (lower("name"));

-- ---------------------------------------------------------------------------
-- The seven starting services (editable in the app afterwards)
-- ---------------------------------------------------------------------------
INSERT INTO "services" ("id", "name", "description", "kind", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid(), 'Lawn Mowing & Edging', 'Mowing, edging along paths and beds, and clearing of cut grass.', 'CORE', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Garden Maintenance', 'Weed control, pruning, planting and bed care.', 'CORE', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Hedge & Shrub Trimming', 'Shaping and trimming of hedges and shrubs.', 'CORE', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Seasonal Clean-Ups', 'Leaf removal, debris clearing and garden refreshes.', 'CORE', 4, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Commercial & Complex Contracts', 'Tailored maintenance plans for complexes, HOAs and business parks.', 'CORE', 5, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Waste Removal', 'Removal of garden waste from site.', 'CORE', 6, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Weed Treatment', 'Treatment to control weeds in lawns and beds.', 'OPTIONAL_EXTRA', 7, CURRENT_TIMESTAMP);
