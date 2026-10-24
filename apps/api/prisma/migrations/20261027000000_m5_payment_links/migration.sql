-- CreateEnum
CREATE TYPE "PaymentLinkStatus" AS ENUM ('ACTIVE', 'PAID', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "payment_links" (
    "id" UUID NOT NULL,
    "link_id" TEXT NOT NULL,
    "agreement_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "gateway" TEXT NOT NULL,
    "gateway_ref" TEXT,
    "url" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" "PaymentLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "payment_id" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "closed_note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_link_id_key" ON "payment_links"("link_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_payment_id_key" ON "payment_links"("payment_id");

-- CreateIndex
CREATE INDEX "payment_links_agreement_id_status_idx" ON "payment_links"("agreement_id", "status");

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules Prisma cannot express in the schema (kept by hand)
-- ---------------------------------------------------------------------------

-- Amount is positive; a paid link names its payment; a closed link says when.
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_status_rules" CHECK (
    "amount" > 0
    AND (("status" = 'PAID') = ("payment_id" IS NOT NULL))
    AND (("status" = 'ACTIVE') = ("closed_at" IS NULL))
);

-- At most one open link per agreement, so a driver never has two to pay.
CREATE UNIQUE INDEX "payment_links_one_active_per_agreement" ON "payment_links"("agreement_id")
    WHERE "status" = 'ACTIVE';

-- A closed link is final.
CREATE FUNCTION "payment_links_block_changes"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'payment links cannot be deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD."status" <> 'ACTIVE' THEN
        RAISE EXCEPTION 'a paid, expired or cancelled payment link cannot be changed'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."amount" IS DISTINCT FROM OLD."amount" OR NEW."link_id" IS DISTINCT FROM OLD."link_id"
        OR NEW."agreement_id" IS DISTINCT FROM OLD."agreement_id" THEN
        RAISE EXCEPTION 'a payment link''s amount and agreement cannot be changed'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "payment_links_guard"
    BEFORE UPDATE OR DELETE ON "payment_links"
    FOR EACH ROW EXECUTE FUNCTION "payment_links_block_changes"();
