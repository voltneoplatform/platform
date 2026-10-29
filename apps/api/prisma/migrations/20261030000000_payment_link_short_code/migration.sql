-- Short codes for payment links, sent by SMS as https://api.voltcompany.in/p/<code>
-- so the link fits one DLT template variable (TRAI). Older links have none.
ALTER TABLE "payment_links" ADD COLUMN "short_code" TEXT;

CREATE UNIQUE INDEX "payment_links_short_code_key" ON "payment_links"("short_code");

ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_short_code_format"
    CHECK ("short_code" IS NULL OR "short_code" ~ '^[A-Za-z0-9]{8}$');

-- The short code joins the amount and agreement as fixed once a link exists.
CREATE OR REPLACE FUNCTION "payment_links_block_changes"() RETURNS trigger
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
        OR NEW."agreement_id" IS DISTINCT FROM OLD."agreement_id"
        OR NEW."short_code" IS DISTINCT FROM OLD."short_code" THEN
        RAISE EXCEPTION 'a payment link''s amount, agreement and short code cannot be changed'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;
