-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('TOTO', 'E_RICKSHAW', 'E_THREE_WHEELER');

-- CreateEnum
CREATE TYPE "BatteryTypeStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BatteryStatus" AS ENUM ('IN_STOCK', 'INSTALLED', 'UNDER_REPAIR', 'RECOVERED', 'TRANSFERRED', 'RETIRED');

-- CreateEnum
CREATE TYPE "CustodyHolder" AS ENUM ('STOCK', 'TECHNICIAN', 'DRIVER', 'RECOVERED', 'RETIRED');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "PlanVersionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('IMMOBILISE', 'RESTORE', 'RECOVER', 'VARIATION', 'REFUND', 'WRITE_OFF', 'PAYMENT_EDIT', 'BATTERY_RETIRE', 'COST_FLOOR_EXCEPTION');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DriverLanguage" AS ENUM ('BN', 'HI', 'EN');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "KycDocType" AS ENUM ('AADHAAR', 'VOTER_ID', 'DRIVING_LICENCE', 'PAN', 'PASSPORT', 'RATION_CARD', 'OTHER_ID', 'DRIVER_PHOTO');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "battery_types" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "voltage" DECIMAL(6,1) NOT NULL,
    "capacity_ah" DECIMAL(7,1) NOT NULL,
    "chemistry" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "warranty_months" INTEGER NOT NULL,
    "warranty_notes" TEXT,
    "compatible_vehicles" "VehicleType"[],
    "notes" TEXT,
    "status" "BatteryTypeStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "battery_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battery_type_costs" (
    "id" UUID NOT NULL,
    "battery_type_id" UUID NOT NULL,
    "purchase_cost" INTEGER NOT NULL,
    "gps_cost" INTEGER NOT NULL DEFAULT 0,
    "service_cost" INTEGER NOT NULL DEFAULT 0,
    "financing_cost" INTEGER NOT NULL DEFAULT 0,
    "collection_cost" INTEGER NOT NULL DEFAULT 0,
    "expected_loss_cost" INTEGER NOT NULL DEFAULT 0,
    "cost_floor" INTEGER NOT NULL,
    "note" TEXT,
    "entered_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battery_type_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batteries" (
    "id" UUID NOT NULL,
    "serial" TEXT NOT NULL,
    "battery_type_id" UUID NOT NULL,
    "gps_device_id" TEXT,
    "status" "BatteryStatus" NOT NULL DEFAULT 'IN_STOCK',
    "holder" "CustodyHolder" NOT NULL DEFAULT 'STOCK',
    "location" TEXT,
    "holder_staff_id" UUID,
    "holder_driver_id" UUID,
    "purchase_date" DATE NOT NULL,
    "purchase_cost" INTEGER NOT NULL,
    "supplier_ref" TEXT,
    "notes" TEXT,
    "retired_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "batteries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battery_custody" (
    "id" UUID NOT NULL,
    "battery_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "from_status" "BatteryStatus",
    "to_status" "BatteryStatus" NOT NULL,
    "from_holder" "CustodyHolder",
    "to_holder" "CustodyHolder" NOT NULL,
    "to_location" TEXT,
    "to_staff_id" UUID,
    "to_driver_id" UUID,
    "note" TEXT,
    "by_id" UUID,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battery_custody_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name_bn" TEXT NOT NULL,
    "name_hi" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_versions" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PlanVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "term_months" INTEGER,
    "grace_days" INTEGER NOT NULL,
    "late_fee_per_day_paise" INTEGER NOT NULL,
    "late_fee_cap_days" INTEGER NOT NULL,
    "name_bn" TEXT,
    "name_hi" TEXT,
    "name_en" TEXT,
    "notes" TEXT,
    "cost_floor_passed" BOOLEAN,
    "cost_floor_check" JSONB,
    "cost_floor_exception" BOOLEAN NOT NULL DEFAULT false,
    "approval_request_id" UUID,
    "exception_approved_by_id" UUID,
    "published_by_id" UUID,
    "published_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_version_prices" (
    "id" UUID NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "battery_type_id" UUID NOT NULL,
    "down_payment" INTEGER NOT NULL,
    "instalment" INTEGER NOT NULL,
    "total_payable" INTEGER NOT NULL,
    "cost_floor" INTEGER,

    CONSTRAINT "plan_version_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "target_table" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "payload" JSONB,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "alt_phone" TEXT,
    "language" "DriverLanguage" NOT NULL,
    "date_of_birth" DATE,
    "address_line" TEXT NOT NULL,
    "area" TEXT,
    "district" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'West Bengal',
    "pin_code" TEXT NOT NULL,
    "status" "DriverStatus" NOT NULL DEFAULT 'ACTIVE',
    "nominee_name" TEXT,
    "nominee_relation" TEXT,
    "nominee_phone" TEXT,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_documents" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "type" "KycDocType" NOT NULL,
    "number_encrypted" TEXT,
    "number_last4" TEXT,
    "number_index" TEXT,
    "used_for_address" BOOLEAN NOT NULL DEFAULT false,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "verified_by_id" UUID,
    "verified_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "registration" TEXT,
    "chassis_number" TEXT,
    "type" "VehicleType" NOT NULL,
    "make_model" TEXT,
    "owned_by_driver" BOOLEAN NOT NULL,
    "owner_name" TEXT,
    "owner_phone" TEXT,
    "owner_consent_file_key" TEXT,
    "owner_consent_file_name" TEXT,
    "owner_consent_file_type" TEXT,
    "owner_consent_uploaded_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "battery_types_name_key" ON "battery_types"("name");

-- CreateIndex
CREATE INDEX "battery_type_costs_battery_type_id_created_at_idx" ON "battery_type_costs"("battery_type_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "batteries_serial_key" ON "batteries"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "batteries_gps_device_id_key" ON "batteries"("gps_device_id");

-- CreateIndex
CREATE INDEX "batteries_battery_type_id_idx" ON "batteries"("battery_type_id");

-- CreateIndex
CREATE INDEX "batteries_status_idx" ON "batteries"("status");

-- CreateIndex
CREATE INDEX "battery_custody_battery_id_at_idx" ON "battery_custody"("battery_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "plans_seq_key" ON "plans"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "plan_versions_plan_id_version_key" ON "plan_versions"("plan_id", "version");

-- CreateIndex
CREATE INDEX "plan_version_prices_battery_type_id_idx" ON "plan_version_prices"("battery_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_version_prices_plan_version_id_battery_type_id_key" ON "plan_version_prices"("plan_version_id", "battery_type_id");

-- CreateIndex
CREATE INDEX "approval_requests_status_type_idx" ON "approval_requests"("status", "type");

-- CreateIndex
CREATE INDEX "approval_requests_target_table_target_id_idx" ON "approval_requests"("target_table", "target_id");

-- CreateIndex
CREATE INDEX "drivers_phone_idx" ON "drivers"("phone");

-- CreateIndex
CREATE INDEX "kyc_documents_driver_id_idx" ON "kyc_documents"("driver_id");

-- CreateIndex
CREATE INDEX "kyc_documents_number_index_idx" ON "kyc_documents"("number_index");

-- CreateIndex
CREATE INDEX "vehicles_driver_id_idx" ON "vehicles"("driver_id");

-- CreateIndex
CREATE INDEX "vehicles_registration_idx" ON "vehicles"("registration");

-- AddForeignKey
ALTER TABLE "battery_type_costs" ADD CONSTRAINT "battery_type_costs_battery_type_id_fkey" FOREIGN KEY ("battery_type_id") REFERENCES "battery_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batteries" ADD CONSTRAINT "batteries_battery_type_id_fkey" FOREIGN KEY ("battery_type_id") REFERENCES "battery_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batteries" ADD CONSTRAINT "batteries_holder_driver_id_fkey" FOREIGN KEY ("holder_driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battery_custody" ADD CONSTRAINT "battery_custody_battery_id_fkey" FOREIGN KEY ("battery_id") REFERENCES "batteries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_version_prices" ADD CONSTRAINT "plan_version_prices_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_version_prices" ADD CONSTRAINT "plan_version_prices_battery_type_id_fkey" FOREIGN KEY ("battery_type_id") REFERENCES "battery_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules Prisma cannot express in the schema (kept by hand)
-- ---------------------------------------------------------------------------

-- Money is whole paise and never negative.
ALTER TABLE "battery_type_costs" ADD CONSTRAINT "battery_type_costs_amounts_valid" CHECK (
    "purchase_cost" > 0 AND "gps_cost" >= 0 AND "service_cost" >= 0 AND "financing_cost" >= 0
    AND "collection_cost" >= 0 AND "expected_loss_cost" >= 0
    AND "cost_floor" = "purchase_cost" + "gps_cost" + "service_cost" + "financing_cost"
        + "collection_cost" + "expected_loss_cost"
);

ALTER TABLE "batteries" ADD CONSTRAINT "batteries_purchase_cost_valid" CHECK ("purchase_cost" > 0);

ALTER TABLE "plan_version_prices" ADD CONSTRAINT "plan_version_prices_amounts_valid" CHECK (
    "down_payment" >= 0 AND "instalment" > 0 AND "total_payable" > 0
);

ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_term_valid" CHECK (
    "term_months" IS NULL OR ("term_months" BETWEEN 1 AND 120)
);

-- A published version is frozen: its terms and prices never change (spec rule 1).
CREATE FUNCTION "plan_version_block_published_changes"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'published plan versions cannot be deleted'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD."status" IN ('PUBLISHED', 'SUPERSEDED') AND (
        NEW."term_months" IS DISTINCT FROM OLD."term_months"
        OR NEW."grace_days" IS DISTINCT FROM OLD."grace_days"
        OR NEW."late_fee_per_day_paise" IS DISTINCT FROM OLD."late_fee_per_day_paise"
        OR NEW."late_fee_cap_days" IS DISTINCT FROM OLD."late_fee_cap_days"
        OR NEW."name_bn" IS DISTINCT FROM OLD."name_bn"
        OR NEW."name_hi" IS DISTINCT FROM OLD."name_hi"
        OR NEW."name_en" IS DISTINCT FROM OLD."name_en"
        OR NEW."plan_id" IS DISTINCT FROM OLD."plan_id"
        OR NEW."version" IS DISTINCT FROM OLD."version"
        OR NEW."published_at" IS DISTINCT FROM OLD."published_at"
        OR NEW."status" NOT IN ('PUBLISHED', 'SUPERSEDED')
    ) THEN
        RAISE EXCEPTION 'published plan versions cannot be changed'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "plan_versions_frozen"
    BEFORE UPDATE ON "plan_versions"
    FOR EACH ROW EXECUTE FUNCTION "plan_version_block_published_changes"();

CREATE TRIGGER "plan_versions_no_delete_published"
    BEFORE DELETE ON "plan_versions"
    FOR EACH ROW WHEN (OLD."status" IN ('PUBLISHED', 'SUPERSEDED'))
    EXECUTE FUNCTION "plan_version_block_published_changes"();

CREATE FUNCTION "plan_version_price_block_published_changes"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_status "PlanVersionStatus";
BEGIN
    SELECT "status" INTO v_status FROM "plan_versions"
        WHERE "id" = COALESCE(NEW."plan_version_id", OLD."plan_version_id");
    IF v_status IN ('PUBLISHED', 'SUPERSEDED') THEN
        RAISE EXCEPTION 'prices of a published plan version cannot be changed'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "plan_version_prices_frozen"
    BEFORE INSERT OR UPDATE OR DELETE ON "plan_version_prices"
    FOR EACH ROW EXECUTE FUNCTION "plan_version_price_block_published_changes"();

-- Cost history is append-only: a change adds a row.
CREATE FUNCTION "battery_type_costs_block_changes"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'battery_type_costs is append-only: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "battery_type_costs_append_only"
    BEFORE UPDATE OR DELETE ON "battery_type_costs"
    FOR EACH ROW EXECUTE FUNCTION "battery_type_costs_block_changes"();

-- Custody history is append-only too.
CREATE TRIGGER "battery_custody_append_only"
    BEFORE UPDATE OR DELETE ON "battery_custody"
    FOR EACH ROW EXECUTE FUNCTION "audit_log_block_changes"();

-- A vehicle needs a registration number or a chassis number.
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_identifier_present" CHECK (
    "registration" IS NOT NULL OR "chassis_number" IS NOT NULL
);

-- A renter-driver's vehicle records the owner's name and phone.
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_owner_details_for_renters" CHECK (
    "owned_by_driver" OR ("owner_name" IS NOT NULL AND "owner_phone" IS NOT NULL)
);

-- Only one current vehicle per driver.
CREATE UNIQUE INDEX "vehicles_one_current_per_driver" ON "vehicles"("driver_id") WHERE "is_current";

-- Only one pending approval request per action and target.
CREATE UNIQUE INDEX "approval_requests_one_pending" ON "approval_requests"("type", "target_table", "target_id")
    WHERE "status" = 'PENDING';

-- Aadhaar numbers are never stored in full (until legal item L7 is answered).
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_no_full_aadhaar" CHECK (
    "type" <> 'AADHAAR' OR "number_encrypted" IS NULL
);
