-- CreateEnum
CREATE TYPE "AgreementState" AS ENUM ('DRAFT', 'AWAITING_DOWN_PAYMENT', 'AWAITING_INSTALLATION', 'ACTIVE', 'IN_GRACE', 'IMMOBILISED', 'RECOVERED', 'CLOSED', 'PAID_OFF', 'EARLY_EXIT', 'TRANSFERRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InstalmentStatus" AS ENUM ('UNPAID', 'PART_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('UPI', 'CARD', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('MANUAL', 'GATEWAY');

-- CreateEnum
CREATE TYPE "AllocationKind" AS ENUM ('LATE_FEE', 'DOWN_PAYMENT', 'INSTALMENT', 'EXCESS');

-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('GATEWAY_CLEARING', 'BANK', 'CASH_WITH_AGENTS', 'CASH_IN_TRANSIT', 'DOWN_PAYMENTS_RECEIVED', 'INSTALMENTS_RECEIVED', 'LATE_FEES_RECEIVED', 'DRIVER_CREDIT');

-- CreateEnum
CREATE TYPE "CashDepositStatus" AS ENUM ('PENDING', 'RECONCILED');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('PROCESSED', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "counters" (
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "agreements" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "driver_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "battery_type_id" UUID NOT NULL,
    "battery_id" UUID,
    "state" "AgreementState" NOT NULL DEFAULT 'DRAFT',
    "due_day" INTEGER NOT NULL,
    "first_due_date" DATE NOT NULL,
    "down_payment" INTEGER NOT NULL,
    "instalment" INTEGER NOT NULL,
    "term_months" INTEGER NOT NULL,
    "total_payable" INTEGER NOT NULL,
    "grace_days" INTEGER NOT NULL,
    "late_fee_per_day_paise" INTEGER NOT NULL,
    "late_fee_cap_days" INTEGER NOT NULL,
    "language" "DriverLanguage" NOT NULL,
    "document_version" TEXT NOT NULL,
    "schedule_revision" INTEGER NOT NULL DEFAULT 1,
    "signed_at" TIMESTAMPTZ(3),
    "signature_method" TEXT,
    "signed_file_key" TEXT,
    "signed_file_name" TEXT,
    "signed_file_type" TEXT,
    "explained_in_language" "DriverLanguage",
    "explained_by_id" UUID,
    "sign_recorded_by_id" UUID,
    "activated_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instalments" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "due_date" DATE,
    "amount" INTEGER NOT NULL,
    "amount_paid" INTEGER NOT NULL DEFAULT 0,
    "status" "InstalmentStatus" NOT NULL DEFAULT 'UNPAID',
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "instalments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "late_fee_accruals" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "instalment_id" UUID,
    "accrual_date" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "amount_paid" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "late_fee_accruals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_events" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "from_state" "AgreementState",
    "to_state" "AgreementState" NOT NULL,
    "reason" TEXT,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installations" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "battery_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "technician_id" UUID NOT NULL,
    "installed_at" TIMESTAMPTZ(3) NOT NULL,
    "location" TEXT NOT NULL,
    "voltage_reading" DECIMAL(6,2) NOT NULL,
    "readings_note" TEXT,
    "condition_note" TEXT NOT NULL,
    "driver_confirmed" BOOLEAN NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installation_photos" (
    "id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installation_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "agreement_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "excess" INTEGER NOT NULL DEFAULT 0,
    "balance_after" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "source" "PaymentSource" NOT NULL,
    "provider" TEXT,
    "provider_ref" TEXT,
    "reference" TEXT,
    "collected_by_id" UUID,
    "recorded_by_id" UUID,
    "client_request_id" TEXT,
    "note" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "kind" "AllocationKind" NOT NULL,
    "instalment_id" UUID,
    "late_fee_id" UUID,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_journals" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "payment_id" UUID,
    "cash_deposit_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" BIGSERIAL NOT NULL,
    "journal_id" UUID NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "agreement_id" UUID,
    "staff_id" UUID,
    "debit" INTEGER NOT NULL DEFAULT 0,
    "credit" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_deposits" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "bank_reference" TEXT NOT NULL,
    "deposited_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "CashDepositStatus" NOT NULL DEFAULT 'PENDING',
    "recorded_by_id" UUID NOT NULL,
    "reconciled_by_id" UUID,
    "reconciled_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cash_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_messages" (
    "id" UUID NOT NULL,
    "driver_id" UUID,
    "to_phone" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "template" TEXT NOT NULL,
    "language" "DriverLanguage" NOT NULL,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "provider_ref" TEXT,
    "error" TEXT,
    "payment_id" UUID,
    "agreement_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL,
    "note" TEXT,
    "payment_id" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agreements_number_key" ON "agreements"("number");

-- CreateIndex
CREATE INDEX "agreements_driver_id_idx" ON "agreements"("driver_id");

-- CreateIndex
CREATE INDEX "agreements_state_idx" ON "agreements"("state");

-- CreateIndex
CREATE INDEX "agreements_battery_id_idx" ON "agreements"("battery_id");

-- CreateIndex
CREATE INDEX "instalments_due_date_status_idx" ON "instalments"("due_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "instalments_agreement_id_sequence_key" ON "instalments"("agreement_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "late_fee_accruals_agreement_id_accrual_date_key" ON "late_fee_accruals"("agreement_id", "accrual_date");

-- CreateIndex
CREATE INDEX "agreement_events_agreement_id_at_idx" ON "agreement_events"("agreement_id", "at");

-- CreateIndex
CREATE INDEX "installations_agreement_id_idx" ON "installations"("agreement_id");

-- CreateIndex
CREATE INDEX "installation_photos_installation_id_idx" ON "installation_photos"("installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_receipt_number_key" ON "payments"("receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "payments_client_request_id_key" ON "payments"("client_request_id");

-- CreateIndex
CREATE INDEX "payments_agreement_id_received_at_idx" ON "payments"("agreement_id", "received_at");

-- CreateIndex
CREATE INDEX "payments_collected_by_id_idx" ON "payments"("collected_by_id");

-- CreateIndex
CREATE INDEX "payments_received_at_idx" ON "payments"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_ref_key" ON "payments"("provider", "provider_ref");

-- CreateIndex
CREATE INDEX "payment_allocations_payment_id_idx" ON "payment_allocations"("payment_id");

-- CreateIndex
CREATE INDEX "payment_allocations_instalment_id_idx" ON "payment_allocations"("instalment_id");

-- CreateIndex
CREATE INDEX "ledger_journals_payment_id_idx" ON "ledger_journals"("payment_id");

-- CreateIndex
CREATE INDEX "ledger_journals_cash_deposit_id_idx" ON "ledger_journals"("cash_deposit_id");

-- CreateIndex
CREATE INDEX "ledger_entries_journal_id_idx" ON "ledger_entries"("journal_id");

-- CreateIndex
CREATE INDEX "ledger_entries_account_staff_id_idx" ON "ledger_entries"("account", "staff_id");

-- CreateIndex
CREATE INDEX "ledger_entries_agreement_id_idx" ON "ledger_entries"("agreement_id");

-- CreateIndex
CREATE INDEX "cash_deposits_agent_id_idx" ON "cash_deposits"("agent_id");

-- CreateIndex
CREATE INDEX "cash_deposits_status_idx" ON "cash_deposits"("status");

-- CreateIndex
CREATE INDEX "outbound_messages_driver_id_created_at_idx" ON "outbound_messages"("driver_id", "created_at");

-- CreateIndex
CREATE INDEX "outbound_messages_payment_id_idx" ON "outbound_messages"("payment_id");

-- CreateIndex
CREATE INDEX "outbound_messages_status_idx" ON "outbound_messages"("status");

-- CreateIndex
CREATE INDEX "webhook_events_status_idx" ON "webhook_events"("status");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_event_id_key" ON "webhook_events"("provider", "event_id");

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_battery_type_id_fkey" FOREIGN KEY ("battery_type_id") REFERENCES "battery_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_battery_id_fkey" FOREIGN KEY ("battery_id") REFERENCES "batteries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instalments" ADD CONSTRAINT "instalments_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "late_fee_accruals" ADD CONSTRAINT "late_fee_accruals_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "late_fee_accruals" ADD CONSTRAINT "late_fee_accruals_instalment_id_fkey" FOREIGN KEY ("instalment_id") REFERENCES "instalments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_events" ADD CONSTRAINT "agreement_events_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installations" ADD CONSTRAINT "installations_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installations" ADD CONSTRAINT "installations_battery_id_fkey" FOREIGN KEY ("battery_id") REFERENCES "batteries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installations" ADD CONSTRAINT "installations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installation_photos" ADD CONSTRAINT "installation_photos_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_instalment_id_fkey" FOREIGN KEY ("instalment_id") REFERENCES "instalments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_late_fee_id_fkey" FOREIGN KEY ("late_fee_id") REFERENCES "late_fee_accruals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_cash_deposit_id_fkey" FOREIGN KEY ("cash_deposit_id") REFERENCES "cash_deposits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "ledger_journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules Prisma cannot express in the schema (kept by hand)
-- ---------------------------------------------------------------------------

-- Agreement figures are consistent: due day is the 2nd or 17th (clause B4), the
-- first due date falls on it, and the total is the down payment plus every
-- instalment (clause B1).
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_terms_valid" CHECK (
    "due_day" IN (2, 17)
    AND EXTRACT(DAY FROM "first_due_date") = "due_day"
    AND "down_payment" >= 0 AND "instalment" > 0
    AND "term_months" BETWEEN 1 AND 120
    AND "total_payable" = "down_payment" + "instalment" * "term_months"
    AND "grace_days" >= 0 AND "late_fee_per_day_paise" >= 0 AND "late_fee_cap_days" >= 0
);

-- Signed agreements record the signed copy and who explained it.
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_signed_record" CHECK (
    "state" IN ('DRAFT', 'CANCELLED')
    OR ("signed_at" IS NOT NULL AND "signed_file_key" IS NOT NULL
        AND "explained_in_language" IS NOT NULL AND "explained_by_id" IS NOT NULL)
);

-- Installed agreements name their battery.
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_battery_after_installation" CHECK (
    "state" IN ('DRAFT', 'AWAITING_DOWN_PAYMENT', 'AWAITING_INSTALLATION', 'CANCELLED')
    OR "battery_id" IS NOT NULL
);

-- One open agreement per driver, per vehicle and per battery (PROPOSED).
CREATE UNIQUE INDEX "agreements_one_open_per_driver" ON "agreements"("driver_id")
    WHERE "state" NOT IN ('CLOSED', 'TRANSFERRED', 'CANCELLED');
CREATE UNIQUE INDEX "agreements_one_open_per_vehicle" ON "agreements"("vehicle_id")
    WHERE "state" NOT IN ('CLOSED', 'TRANSFERRED', 'CANCELLED');
CREATE UNIQUE INDEX "agreements_one_open_per_battery" ON "agreements"("battery_id")
    WHERE "battery_id" IS NOT NULL AND "state" NOT IN ('CLOSED', 'TRANSFERRED', 'CANCELLED');

-- Once signed, the terms never change (spec rule 1). Only the first due date can
-- move, and only before installation, through an approved variation.
CREATE FUNCTION "agreements_block_term_changes"() RETURNS trigger
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
        OR (OLD."battery_id" IS NOT NULL AND NEW."battery_id" IS DISTINCT FROM OLD."battery_id")
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

CREATE TRIGGER "agreements_terms_frozen"
    BEFORE UPDATE OR DELETE ON "agreements"
    FOR EACH ROW EXECUTE FUNCTION "agreements_block_term_changes"();

-- Instalments: amounts are positive, paid amounts stay within them, and the
-- status matches what has been paid.
ALTER TABLE "instalments" ADD CONSTRAINT "instalments_amounts_valid" CHECK (
    "sequence" >= 0 AND "amount" > 0
    AND "amount_paid" BETWEEN 0 AND "amount"
    AND ("sequence" = 0) = ("due_date" IS NULL)
    AND "status" = CASE
        WHEN "amount_paid" = 0 THEN 'UNPAID'::"InstalmentStatus"
        WHEN "amount_paid" = "amount" THEN 'PAID'::"InstalmentStatus"
        ELSE 'PART_PAID'::"InstalmentStatus" END
    AND (("status" = 'PAID') = ("paid_at" IS NOT NULL))
);

-- An instalment's amount and place in the schedule never change, and rows are
-- never deleted. Only the payment fields and (before installation) the due date move.
CREATE FUNCTION "instalments_block_changes"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'instalments cannot be deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."agreement_id" IS DISTINCT FROM OLD."agreement_id"
        OR NEW."sequence" IS DISTINCT FROM OLD."sequence"
        OR NEW."amount" IS DISTINCT FROM OLD."amount"
        OR NEW."amount_paid" < OLD."amount_paid" THEN
        RAISE EXCEPTION 'instalment amounts cannot be changed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "instalments_protected"
    BEFORE UPDATE OR DELETE ON "instalments"
    FOR EACH ROW EXECUTE FUNCTION "instalments_block_changes"();

ALTER TABLE "late_fee_accruals" ADD CONSTRAINT "late_fee_accruals_amounts_valid" CHECK (
    "amount" > 0 AND "amount_paid" BETWEEN 0 AND "amount"
);

-- Payments: positive amounts; cash names the agent holding it; gateway payments
-- name the provider and its reference; manual UPI and card payments carry one.
ALTER TABLE "payments" ADD CONSTRAINT "payments_valid" CHECK (
    "amount" > 0 AND "excess" BETWEEN 0 AND "amount" AND "balance_after" >= 0
    AND ("method" <> 'CASH' OR ("collected_by_id" IS NOT NULL AND "source" = 'MANUAL'))
    AND ("source" <> 'GATEWAY' OR ("provider" IS NOT NULL AND "provider_ref" IS NOT NULL))
    AND ("source" <> 'MANUAL' OR "method" = 'CASH' OR "reference" IS NOT NULL)
);

-- The same bank or UPI reference cannot be entered twice by hand.
CREATE UNIQUE INDEX "payments_manual_reference_unique" ON "payments"("method", "reference")
    WHERE "source" = 'MANUAL' AND "reference" IS NOT NULL;

ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_target_valid" CHECK (
    "amount" > 0 AND CASE "kind"
        WHEN 'LATE_FEE' THEN "late_fee_id" IS NOT NULL AND "instalment_id" IS NULL
        WHEN 'EXCESS' THEN "late_fee_id" IS NULL AND "instalment_id" IS NULL
        ELSE "instalment_id" IS NOT NULL AND "late_fee_id" IS NULL END
);

-- Ledger lines are one-sided and positive.
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_one_sided" CHECK (
    ("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0)
);

-- Every journal balances: checked when the transaction commits.
CREATE FUNCTION "ledger_journal_check_balanced"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_lines INTEGER;
    v_net BIGINT;
BEGIN
    SELECT COUNT(*), COALESCE(SUM("debit"::BIGINT - "credit"::BIGINT), 0)
        INTO v_lines, v_net
        FROM "ledger_entries" WHERE "journal_id" = NEW."journal_id";
    IF v_lines < 2 OR v_net <> 0 THEN
        RAISE EXCEPTION 'ledger journal % does not balance', NEW."journal_id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ledger_entries_balanced"
    AFTER INSERT ON "ledger_entries"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "ledger_journal_check_balanced"();

ALTER TABLE "cash_deposits" ADD CONSTRAINT "cash_deposits_valid" CHECK (
    "amount" > 0
    AND (("status" = 'RECONCILED') = ("reconciled_by_id" IS NOT NULL AND "reconciled_at" IS NOT NULL))
);

-- Money records and history are append-only (corrections are new, approved entries).
CREATE FUNCTION "append_only_block_changes"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "payments_append_only"
    BEFORE UPDATE OR DELETE ON "payments"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();
CREATE TRIGGER "payment_allocations_append_only"
    BEFORE UPDATE OR DELETE ON "payment_allocations"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();
CREATE TRIGGER "ledger_journals_append_only"
    BEFORE UPDATE OR DELETE ON "ledger_journals"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();
CREATE TRIGGER "ledger_entries_append_only"
    BEFORE UPDATE OR DELETE ON "ledger_entries"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();
CREATE TRIGGER "agreement_events_append_only"
    BEFORE UPDATE OR DELETE ON "agreement_events"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();
CREATE TRIGGER "installations_append_only"
    BEFORE UPDATE OR DELETE ON "installations"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();
CREATE TRIGGER "installation_photos_append_only"
    BEFORE UPDATE OR DELETE ON "installation_photos"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();
