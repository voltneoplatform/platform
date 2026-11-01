-- Founder, 1 Nov 2026: the driver gives an OTP at registration, the Field App
-- records where the driver was registered, a plan is chosen, and head office
-- (super admin, operations manager or plan manager) gives final approval.
CREATE TYPE "DriverApproval" AS ENUM ('AWAITING', 'APPROVED', 'REJECTED');

ALTER TABLE "drivers"
    ADD COLUMN "phone_verified_at" TIMESTAMPTZ(3),
    ADD COLUMN "phone_verified_by_id" UUID,
    ADD COLUMN "consent_version" TEXT,
    ADD COLUMN "consent_at" TIMESTAMPTZ(3),
    ADD COLUMN "registered_lat" DOUBLE PRECISION,
    ADD COLUMN "registered_lng" DOUBLE PRECISION,
    ADD COLUMN "registered_accuracy_m" DOUBLE PRECISION,
    ADD COLUMN "plan_id" UUID,
    ADD COLUMN "approval" "DriverApproval" NOT NULL DEFAULT 'AWAITING',
    ADD COLUMN "approval_reason" TEXT,
    ADD COLUMN "approved_by_id" UUID,
    ADD COLUMN "approved_at" TIMESTAMPTZ(3),
    ADD CONSTRAINT "drivers_registered_location" CHECK (
        ("registered_lat" IS NULL) = ("registered_lng" IS NULL)
        AND ("registered_lat" IS NULL) = ("registered_accuracy_m" IS NULL)
    );
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "drivers_approval_idx" ON "drivers"("approval");

-- Drivers who already have an agreement were approved in practice, on its plan.
UPDATE "drivers" d SET
    "approval" = 'APPROVED',
    "approved_at" = a."created_at",
    "plan_id" = pv."plan_id"
FROM (
    SELECT DISTINCT ON ("driver_id") "driver_id", "plan_version_id", "created_at"
    FROM "agreements" WHERE "state" <> 'CANCELLED'
    ORDER BY "driver_id", "created_at" DESC
) a
JOIN "plan_versions" pv ON pv."id" = a."plan_version_id"
WHERE d."id" = a."driver_id";

-- A code sent to the driver's phone while staff register them. Once the right
-- code is entered, the check can be used once, by the same staff member, to
-- save that phone number on a driver.
CREATE TABLE "driver_phone_checks" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "staff_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "used_at" TIMESTAMPTZ(3),
    "used_for_driver_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_phone_checks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "driver_phone_checks_phone_created_at_idx" ON "driver_phone_checks"("phone", "created_at");

-- Every approval and rejection, kept permanently.
CREATE TYPE "DriverDecision" AS ENUM ('APPROVED', 'REJECTED');
CREATE TABLE "driver_approval_decisions" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "decision" "DriverDecision" NOT NULL,
    "plan_id" UUID,
    "reason" TEXT,
    "decided_by_id" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_approval_decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "driver_approval_decisions_shape" CHECK (
        ("decision" = 'APPROVED' AND "plan_id" IS NOT NULL)
        OR ("decision" = 'REJECTED' AND "reason" IS NOT NULL AND length(trim("reason")) > 0)
    )
);
CREATE INDEX "driver_approval_decisions_driver_id_idx" ON "driver_approval_decisions"("driver_id", "decided_at");
ALTER TABLE "driver_approval_decisions" ADD CONSTRAINT "driver_approval_decisions_driver_id_fkey"
    FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "driver_approval_decisions" ADD CONSTRAINT "driver_approval_decisions_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "driver_approval_decisions_append_only"
    BEFORE UPDATE OR DELETE ON "driver_approval_decisions"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();

-- Founder, 1 Nov 2026: head office assigns a battery to an approved driver,
-- and the agreement is prepared with that battery's serial number and IMEI.
-- The battery can be changed until it is installed; after signing, the driver
-- signs a corrected agreement before installation.
ALTER TABLE "agreements" ADD COLUMN "resign_required" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "agreement_battery_changes" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "from_battery_id" UUID NOT NULL,
    "to_battery_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "after_signing" BOOLEAN NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_battery_changes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agreement_battery_changes_reason" CHECK (length(trim("reason")) > 0),
    CONSTRAINT "agreement_battery_changes_different" CHECK ("from_battery_id" <> "to_battery_id")
);
CREATE INDEX "agreement_battery_changes_agreement_id_idx" ON "agreement_battery_changes"("agreement_id", "changed_at");
ALTER TABLE "agreement_battery_changes" ADD CONSTRAINT "agreement_battery_changes_agreement_id_fkey"
    FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agreement_battery_changes" ADD CONSTRAINT "agreement_battery_changes_from_battery_id_fkey"
    FOREIGN KEY ("from_battery_id") REFERENCES "batteries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agreement_battery_changes" ADD CONSTRAINT "agreement_battery_changes_to_battery_id_fkey"
    FOREIGN KEY ("to_battery_id") REFERENCES "batteries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "agreement_battery_changes_append_only"
    BEFORE UPDATE OR DELETE ON "agreement_battery_changes"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();

-- The corrected agreement the driver signs after a battery change.
CREATE TABLE "agreement_resignings" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "battery_change_id" UUID NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "signed_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_resignings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agreement_resignings_battery_change_id_key" ON "agreement_resignings"("battery_change_id");
CREATE INDEX "agreement_resignings_agreement_id_idx" ON "agreement_resignings"("agreement_id", "recorded_at");
ALTER TABLE "agreement_resignings" ADD CONSTRAINT "agreement_resignings_agreement_id_fkey"
    FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agreement_resignings" ADD CONSTRAINT "agreement_resignings_battery_change_id_fkey"
    FOREIGN KEY ("battery_change_id") REFERENCES "agreement_battery_changes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "agreement_resignings_append_only"
    BEFORE UPDATE OR DELETE ON "agreement_resignings"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();

-- Where the Field App recorded the installation (null for head office records
-- and for installations recorded before this).
ALTER TABLE "installations"
    ADD COLUMN "geo_lat" DOUBLE PRECISION,
    ADD COLUMN "geo_lng" DOUBLE PRECISION,
    ADD COLUMN "geo_accuracy_m" DOUBLE PRECISION,
    ADD CONSTRAINT "installations_geo_complete" CHECK (
        ("geo_lat" IS NULL) = ("geo_lng" IS NULL) AND ("geo_lat" IS NULL) = ("geo_accuracy_m" IS NULL)
    );

-- A signed agreement's battery may now change before installation, only through
-- the battery-change step (which sets voltneo.reassigning_battery_for).
CREATE OR REPLACE FUNCTION "agreements_block_term_changes"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'agreements cannot be deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD."state" <> 'DRAFT' AND (
        NEW."number" IS DISTINCT FROM OLD."number"
        OR NEW."driver_id" IS DISTINCT FROM OLD."driver_id"
        OR NEW."vehicle_id" IS DISTINCT FROM OLD."vehicle_id"
        OR NEW."plan_version_id" IS DISTINCT FROM OLD."plan_version_id"
        OR NEW."battery_type_id" IS DISTINCT FROM OLD."battery_type_id"
        OR NEW."due_day" IS DISTINCT FROM OLD."due_day"
        OR NEW."down_payment" IS DISTINCT FROM OLD."down_payment"
        OR NEW."instalment" IS DISTINCT FROM OLD."instalment"
        OR NEW."term_months" IS DISTINCT FROM OLD."term_months"
        OR NEW."total_payable" IS DISTINCT FROM OLD."total_payable"
        OR NEW."grace_days" IS DISTINCT FROM OLD."grace_days"
        OR NEW."late_fee_per_day_paise" IS DISTINCT FROM OLD."late_fee_per_day_paise"
        OR NEW."late_fee_cap_days" IS DISTINCT FROM OLD."late_fee_cap_days"
        OR NEW."document_version" IS DISTINCT FROM OLD."document_version"
        OR NEW."signed_at" IS DISTINCT FROM OLD."signed_at"
        OR NEW."signed_file_key" IS DISTINCT FROM OLD."signed_file_key"
        OR NEW."stamp_paper_number" IS DISTINCT FROM OLD."stamp_paper_number"
        OR NEW."stamp_value" IS DISTINCT FROM OLD."stamp_value"
        OR NEW."stamp_purchased_on" IS DISTINCT FROM OLD."stamp_purchased_on"
        OR (NEW."first_due_date" IS DISTINCT FROM OLD."first_due_date"
            AND OLD."state" NOT IN ('AWAITING_DOWN_PAYMENT', 'AWAITING_INSTALLATION'))
        OR (OLD."battery_id" IS NOT NULL AND NEW."battery_id" IS DISTINCT FROM OLD."battery_id"
            AND (NEW."battery_id" IS NULL
                OR (current_setting('voltneo.replacing_battery_for', true) IS DISTINCT FROM OLD."id"::text
                    AND NOT (OLD."state" IN ('AWAITING_DOWN_PAYMENT', 'AWAITING_INSTALLATION')
                        AND current_setting('voltneo.reassigning_battery_for', true) = OLD."id"::text))))
    ) THEN
        RAISE EXCEPTION 'the terms of a signed agreement cannot be changed'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD."state" IN ('CLOSED', 'TRANSFERRED', 'CANCELLED') AND NEW."state" <> OLD."state" THEN
        RAISE EXCEPTION 'a finished agreement cannot be reopened'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;
