-- Stamp paper used for the signed agreement (founder, 31 Oct 2026): its number
-- (or e-stamp certificate number), value in paise and purchase date. Recorded at
-- signing and fixed afterwards. Agreements signed before this have none.
ALTER TABLE "agreements" ADD COLUMN "stamp_paper_number" TEXT,
    ADD COLUMN "stamp_value" INTEGER,
    ADD COLUMN "stamp_purchased_on" DATE;

ALTER TABLE "agreements" ADD CONSTRAINT "agreements_stamp_paper_complete" CHECK (
    ("stamp_paper_number" IS NULL) = ("stamp_value" IS NULL)
    AND ("stamp_value" IS NULL) = ("stamp_purchased_on" IS NULL)
    AND ("stamp_value" IS NULL OR "stamp_value" > 0)
    AND ("stamp_paper_number" IS NULL OR "state" <> 'DRAFT')
);

-- The stamp details join the signed terms that cannot change.
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
