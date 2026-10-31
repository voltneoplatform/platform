-- UPI AutoPay (M6 part 2, founder 31 Oct 2026): a mandate the driver approves
-- in their UPI app, and one charge per instalment raised before its Due Date.
CREATE TYPE "AutopayStatus" AS ENUM ('PENDING', 'ACTIVE', 'CANCELLED', 'FAILED');
CREATE TYPE "AutopayChargeStatus" AS ENUM ('SCHEDULED', 'NOTIFIED', 'SUCCESS', 'FAILED', 'CANCELLED');

CREATE TABLE "autopay_mandates" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "gateway_ref" TEXT,
    "session_id" TEXT,
    "short_code" TEXT NOT NULL,
    "max_amount" INTEGER NOT NULL,
    "status" "AutopayStatus" NOT NULL DEFAULT 'PENDING',
    "gateway_status" TEXT,
    "status_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "ended_by" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "autopay_mandates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "autopay_mandates_max_amount_positive" CHECK ("max_amount" > 0)
);
CREATE UNIQUE INDEX "autopay_mandates_subscription_id_key" ON "autopay_mandates"("subscription_id");
CREATE UNIQUE INDEX "autopay_mandates_short_code_key" ON "autopay_mandates"("short_code");
CREATE INDEX "autopay_mandates_agreement_id_idx" ON "autopay_mandates"("agreement_id");
-- At most one mandate being set up or in force per agreement.
CREATE UNIQUE INDEX "autopay_mandates_one_live" ON "autopay_mandates"("agreement_id")
    WHERE "status" IN ('PENDING', 'ACTIVE');
ALTER TABLE "autopay_mandates" ADD CONSTRAINT "autopay_mandates_agreement_id_fkey"
    FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "autopay_mandates" ADD CONSTRAINT "autopay_mandates_driver_id_fkey"
    FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "autopay_charges" (
    "id" UUID NOT NULL,
    "mandate_id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "instalment_id" UUID NOT NULL,
    "charge_id" TEXT NOT NULL,
    "gateway_ref" TEXT,
    "amount" INTEGER NOT NULL,
    "scheduled_for" DATE NOT NULL,
    "status" "AutopayChargeStatus" NOT NULL DEFAULT 'SCHEDULED',
    "failure_reason" TEXT,
    "payment_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "autopay_charges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "autopay_charges_amount_positive" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "autopay_charges_charge_id_key" ON "autopay_charges"("charge_id");
CREATE UNIQUE INDEX "autopay_charges_payment_id_key" ON "autopay_charges"("payment_id");
-- One charge per instalment per mandate.
CREATE UNIQUE INDEX "autopay_charges_mandate_id_instalment_id_key" ON "autopay_charges"("mandate_id", "instalment_id");
CREATE INDEX "autopay_charges_status_scheduled_for_idx" ON "autopay_charges"("status", "scheduled_for");
ALTER TABLE "autopay_charges" ADD CONSTRAINT "autopay_charges_mandate_id_fkey"
    FOREIGN KEY ("mandate_id") REFERENCES "autopay_mandates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "autopay_charges" ADD CONSTRAINT "autopay_charges_instalment_id_fkey"
    FOREIGN KEY ("instalment_id") REFERENCES "instalments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
