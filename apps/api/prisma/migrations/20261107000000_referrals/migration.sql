-- Founder, 7 Nov 2026: track who referred each driver. A referrer is an
-- existing driver or an outside person. Every driver gets a Driver ID
-- (VND-000001…), usable as a referral ID.
ALTER TABLE "drivers" ADD COLUMN "code" TEXT;
WITH n AS (
    SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS seq FROM "drivers"
)
UPDATE "drivers" d SET "code" = 'VND-' || lpad(n.seq::text, 6, '0') FROM n WHERE d."id" = n."id";
INSERT INTO "counters" ("name", "value")
    SELECT 'driver', count(*) FROM "drivers" HAVING count(*) > 0
    ON CONFLICT ("name") DO UPDATE SET "value" = GREATEST("counters"."value", EXCLUDED."value");
ALTER TABLE "drivers" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "drivers_code_key" ON "drivers"("code");

CREATE TYPE "ReferrerKind" AS ENUM ('MECHANIC', 'SHOPKEEPER', 'DEALER', 'AGENT', 'OTHER');

-- Outside referrers (not Volt Neo drivers).
CREATE TABLE "referrers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "kind" "ReferrerKind" NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "referrers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "referrers_name" CHECK (length(trim("name")) >= 2)
);
CREATE UNIQUE INDEX "referrers_code_key" ON "referrers"("code");
CREATE UNIQUE INDEX "referrers_phone_key" ON "referrers"("phone");

ALTER TABLE "drivers"
    ADD COLUMN "referred_by_driver_id" UUID,
    ADD COLUMN "referred_by_referrer_id" UUID,
    ADD CONSTRAINT "drivers_one_referrer" CHECK (
        "referred_by_driver_id" IS NULL OR "referred_by_referrer_id" IS NULL
    ),
    ADD CONSTRAINT "drivers_not_self_referred" CHECK ("referred_by_driver_id" <> "id");
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_referred_by_driver_id_fkey"
    FOREIGN KEY ("referred_by_driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_referred_by_referrer_id_fkey"
    FOREIGN KEY ("referred_by_referrer_id") REFERENCES "referrers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "drivers_referred_by_driver_id_idx" ON "drivers"("referred_by_driver_id");
CREATE INDEX "drivers_referred_by_referrer_id_idx" ON "drivers"("referred_by_referrer_id");
