-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('NOT_WORKING', 'LOW_CAPACITY', 'CHARGING', 'PHYSICAL_DAMAGE', 'GPS_MODULE', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketChannel" AS ENUM ('PHONE', 'WHATSAPP', 'FIELD_AGENT', 'WALK_IN', 'APP');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'ASSIGNED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TicketOutcome" AS ENUM ('REPAIRED', 'REPLACED', 'NO_FAULT_FOUND', 'NOT_COVERED');

-- CreateTable
CREATE TABLE "service_tickets" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "agreement_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "battery_id" UUID NOT NULL,
    "category" "TicketCategory" NOT NULL,
    "channel" "TicketChannel" NOT NULL,
    "description" TEXT NOT NULL,
    "reported_at" TIMESTAMPTZ(3) NOT NULL,
    "due_by" TIMESTAMPTZ(3) NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "technician_id" UUID,
    "assigned_at" TIMESTAMPTZ(3),
    "responded_at" TIMESTAMPTZ(3),
    "outcome" "TicketOutcome",
    "resolution" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_visits" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "battery_id" UUID NOT NULL,
    "technician_id" UUID NOT NULL,
    "visited_at" TIMESTAMPTZ(3) NOT NULL,
    "voltage_reading" DECIMAL(6,2),
    "readings_note" TEXT,
    "finding" TEXT NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_photos" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battery_replacements" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "old_battery_id" UUID NOT NULL,
    "new_battery_id" UUID NOT NULL,
    "technician_id" UUID NOT NULL,
    "replaced_at" TIMESTAMPTZ(3) NOT NULL,
    "voltage_reading" DECIMAL(6,2) NOT NULL,
    "old_battery_note" TEXT NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battery_replacements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ownership_transfers" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "battery_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "certificate_number" TEXT NOT NULL,
    "paid_in_full_on" DATE NOT NULL,
    "gps_off_at" TIMESTAMPTZ(3) NOT NULL,
    "gps_portal_reference" TEXT NOT NULL,
    "gps_off_by_id" UUID NOT NULL,
    "transferred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ownership_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_tickets_number_key" ON "service_tickets"("number");

-- CreateIndex
CREATE INDEX "service_tickets_agreement_id_idx" ON "service_tickets"("agreement_id");

-- CreateIndex
CREATE INDEX "service_tickets_status_due_by_idx" ON "service_tickets"("status", "due_by");

-- CreateIndex
CREATE INDEX "service_tickets_technician_id_status_idx" ON "service_tickets"("technician_id", "status");

-- CreateIndex
CREATE INDEX "ticket_visits_ticket_id_idx" ON "ticket_visits"("ticket_id");

-- CreateIndex
CREATE INDEX "ticket_visits_battery_id_visited_at_idx" ON "ticket_visits"("battery_id", "visited_at");

-- CreateIndex
CREATE INDEX "ticket_photos_visit_id_idx" ON "ticket_photos"("visit_id");

-- CreateIndex
CREATE INDEX "battery_replacements_agreement_id_idx" ON "battery_replacements"("agreement_id");

-- CreateIndex
CREATE INDEX "battery_replacements_ticket_id_idx" ON "battery_replacements"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "ownership_transfers_agreement_id_key" ON "ownership_transfers"("agreement_id");

-- CreateIndex
CREATE UNIQUE INDEX "ownership_transfers_certificate_number_key" ON "ownership_transfers"("certificate_number");

-- AddForeignKey
ALTER TABLE "service_tickets" ADD CONSTRAINT "service_tickets_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_visits" ADD CONSTRAINT "ticket_visits_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "service_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_photos" ADD CONSTRAINT "ticket_photos_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "ticket_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battery_replacements" ADD CONSTRAINT "battery_replacements_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battery_replacements" ADD CONSTRAINT "battery_replacements_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "service_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules Prisma cannot express in the schema (kept by hand)
-- ---------------------------------------------------------------------------

-- A ticket's fields match its status; the deadline follows the report (D48).
ALTER TABLE "service_tickets" ADD CONSTRAINT "service_tickets_status_rules" CHECK (
    "due_by" > "reported_at"
    AND ("status" <> 'OPEN' OR "technician_id" IS NULL)
    AND ("status" <> 'ASSIGNED' OR ("technician_id" IS NOT NULL AND "assigned_at" IS NOT NULL))
    AND (("status" = 'RESOLVED') = ("outcome" IS NOT NULL))
    AND ("status" <> 'RESOLVED' OR ("technician_id" IS NOT NULL AND "responded_at" IS NOT NULL
        AND "resolution" IS NOT NULL AND "resolved_at" IS NOT NULL AND "resolved_by_id" IS NOT NULL))
    AND (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL))
);

-- A resolved or cancelled ticket is final; tickets are never deleted.
CREATE FUNCTION "service_tickets_block_changes"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'service tickets cannot be deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD."status" IN ('RESOLVED', 'CANCELLED') THEN
        RAISE EXCEPTION 'a resolved or cancelled ticket cannot be changed'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."number" IS DISTINCT FROM OLD."number"
        OR NEW."agreement_id" IS DISTINCT FROM OLD."agreement_id"
        OR NEW."reported_at" IS DISTINCT FROM OLD."reported_at"
        OR NEW."due_by" IS DISTINCT FROM OLD."due_by"
        OR (OLD."responded_at" IS NOT NULL AND NEW."responded_at" IS DISTINCT FROM OLD."responded_at")
    THEN
        RAISE EXCEPTION 'the report, its deadline and the first response cannot be changed'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "service_tickets_guard"
    BEFORE UPDATE OR DELETE ON "service_tickets"
    FOR EACH ROW EXECUTE FUNCTION "service_tickets_block_changes"();

ALTER TABLE "battery_replacements" ADD CONSTRAINT "battery_replacements_different_battery" CHECK (
    "old_battery_id" <> "new_battery_id"
);

-- Visits, photos, replacements and transfers are append-only.
CREATE TRIGGER "ticket_visits_append_only"
    BEFORE UPDATE OR DELETE ON "ticket_visits"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();
CREATE TRIGGER "ticket_photos_append_only"
    BEFORE UPDATE OR DELETE ON "ticket_photos"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();
CREATE TRIGGER "battery_replacements_append_only"
    BEFORE UPDATE OR DELETE ON "battery_replacements"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();
CREATE TRIGGER "ownership_transfers_append_only"
    BEFORE UPDATE OR DELETE ON "ownership_transfers"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();

-- A transferred agreement records when it was paid in full.
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_transfer_record" CHECK (
    "state" NOT IN ('PAID_OFF', 'EARLY_EXIT', 'TRANSFERRED') OR "completed_at" IS NOT NULL
);

-- The battery on a signed agreement can change only through a recorded
-- replacement (clause C8): the service sets voltneo.replacing_battery_for to
-- the agreement id for the length of its transaction.
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
        OR (NEW."first_due_date" IS DISTINCT FROM OLD."first_due_date"
            AND OLD."state" NOT IN ('AWAITING_DOWN_PAYMENT', 'AWAITING_INSTALLATION'))
        OR (OLD."battery_id" IS NOT NULL AND NEW."battery_id" IS DISTINCT FROM OLD."battery_id"
            AND (NEW."battery_id" IS NULL
                OR current_setting('voltneo.replacing_battery_for', true) IS DISTINCT FROM OLD."id"::text))
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
