-- CreateEnum
CREATE TYPE "ImmobilisationAction" AS ENUM ('DISABLE', 'RESTORE');

-- CreateEnum
CREATE TYPE "NoticeKind" AS ENUM ('REMINDER_5', 'REMINDER_3', 'REMINDER_1', 'REMINDER_0', 'FINAL_NOTICE', 'IMMOBILISED', 'RESTORED');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "agreements" ADD COLUMN     "closed_at" TIMESTAMPTZ(3),
ADD COLUMN     "immobilised_at" TIMESTAMPTZ(3),
ADD COLUMN     "late_spell_started_on" DATE,
ADD COLUMN     "restore_due_since" TIMESTAMPTZ(3),
ADD COLUMN     "written_off_amount" INTEGER,
ADD COLUMN     "written_off_late_fees" INTEGER;

-- CreateTable
CREATE TABLE "immobilisation_log" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "action" "ImmobilisationAction" NOT NULL,
    "approval_request_id" UUID,
    "vehicle_stationary_confirmed" BOOLEAN NOT NULL,
    "portal_reference" TEXT NOT NULL,
    "performed_at" TIMESTAMPTZ(3) NOT NULL,
    "performed_by_id" UUID NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "immobilisation_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recoveries" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "battery_id" UUID NOT NULL,
    "approval_request_id" UUID NOT NULL,
    "recovered_at" TIMESTAMPTZ(3) NOT NULL,
    "recovered_by_id" UUID NOT NULL,
    "location" TEXT NOT NULL,
    "condition_note" TEXT NOT NULL,
    "written_off_amount" INTEGER NOT NULL,
    "written_off_late_fees" INTEGER NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_photos" (
    "id" UUID NOT NULL,
    "recovery_id" UUID NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_notices" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "kind" "NoticeKind" NOT NULL,
    "ref_date" DATE NOT NULL,
    "instalment_id" UUID,
    "message_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "job" TEXT NOT NULL,
    "run_date" DATE NOT NULL,
    "status" "JobRunStatus" NOT NULL,
    "summary" JSONB,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "immobilisation_log_approval_request_id_key" ON "immobilisation_log"("approval_request_id");

-- CreateIndex
CREATE INDEX "immobilisation_log_agreement_id_performed_at_idx" ON "immobilisation_log"("agreement_id", "performed_at");

-- CreateIndex
CREATE UNIQUE INDEX "recoveries_agreement_id_key" ON "recoveries"("agreement_id");

-- CreateIndex
CREATE UNIQUE INDEX "recoveries_approval_request_id_key" ON "recoveries"("approval_request_id");

-- CreateIndex
CREATE INDEX "recovery_photos_recovery_id_idx" ON "recovery_photos"("recovery_id");

-- CreateIndex
CREATE UNIQUE INDEX "collection_notices_agreement_id_kind_ref_date_key" ON "collection_notices"("agreement_id", "kind", "ref_date");

-- CreateIndex
CREATE UNIQUE INDEX "job_runs_job_run_date_key" ON "job_runs"("job", "run_date");

-- AddForeignKey
ALTER TABLE "immobilisation_log" ADD CONSTRAINT "immobilisation_log_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recoveries" ADD CONSTRAINT "recoveries_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_photos" ADD CONSTRAINT "recovery_photos_recovery_id_fkey" FOREIGN KEY ("recovery_id") REFERENCES "recoveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_notices" ADD CONSTRAINT "collection_notices_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules Prisma cannot express in the schema (kept by hand)
-- ---------------------------------------------------------------------------

-- A disable needs an approved request and a confirmed stationary vehicle (D19, D23).
ALTER TABLE "immobilisation_log" ADD CONSTRAINT "immobilisation_log_disable_rules" CHECK (
    "action" <> 'DISABLE' OR ("approval_request_id" IS NOT NULL AND "vehicle_stationary_confirmed")
);

ALTER TABLE "recoveries" ADD CONSTRAINT "recoveries_amounts_valid" CHECK (
    "written_off_amount" >= 0 AND "written_off_late_fees" >= 0
);

-- A disabled agreement records when; a closed one records when and what was written off.
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_collections_record" CHECK (
    ("state" <> 'IMMOBILISED' OR "immobilised_at" IS NOT NULL)
    AND ("state" <> 'CLOSED' OR ("closed_at" IS NOT NULL AND "written_off_amount" IS NOT NULL
        AND "written_off_late_fees" IS NOT NULL))
);

-- Immobilisation and recovery records are append-only.
CREATE TRIGGER "immobilisation_log_append_only"
    BEFORE UPDATE OR DELETE ON "immobilisation_log"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();
CREATE TRIGGER "recoveries_append_only"
    BEFORE UPDATE OR DELETE ON "recoveries"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();
CREATE TRIGGER "recovery_photos_append_only"
    BEFORE UPDATE OR DELETE ON "recovery_photos"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();
