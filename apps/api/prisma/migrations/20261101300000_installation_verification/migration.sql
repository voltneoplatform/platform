-- Founder, 31 Oct 2026: an installation recorded by a field agent or technician
-- is verified by head office (super admin, operations manager or plan manager)
-- before the agreement becomes active. Installations stay append-only, so the
-- decision is its own append-only record. Earlier installations need none.
ALTER TABLE "installations" ADD COLUMN "needs_verification" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "InstallationDecision" AS ENUM ('VERIFIED', 'REJECTED');

CREATE TABLE "installation_decisions" (
    "id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "decision" "InstallationDecision" NOT NULL,
    "reason" TEXT,
    "decided_by_id" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installation_decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "installation_decisions_reason" CHECK (
        ("decision" = 'REJECTED') = ("reason" IS NOT NULL AND length(trim("reason")) > 0)
    )
);
CREATE UNIQUE INDEX "installation_decisions_installation_id_key" ON "installation_decisions"("installation_id");
ALTER TABLE "installation_decisions" ADD CONSTRAINT "installation_decisions_installation_id_fkey"
    FOREIGN KEY ("installation_id") REFERENCES "installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "installation_decisions_append_only"
    BEFORE UPDATE OR DELETE ON "installation_decisions"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();
