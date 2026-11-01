-- Founder, 1 Nov 2026: a field agent or technician closing a service ticket
-- needs approval from a super admin, operations manager or plan manager, who
-- can also close tickets directly. The request and the decision are kept
-- permanently; the ticket waits as CLOSE_REQUESTED in between.
ALTER TYPE "TicketStatus" ADD VALUE 'CLOSE_REQUESTED';

CREATE TABLE "ticket_close_requests" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "outcome" "TicketOutcome" NOT NULL,
    "resolution" TEXT NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_close_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ticket_close_requests_resolution" CHECK (length(trim("resolution")) > 0)
);
CREATE INDEX "ticket_close_requests_ticket_id_requested_at_idx" ON "ticket_close_requests"("ticket_id", "requested_at");
ALTER TABLE "ticket_close_requests" ADD CONSTRAINT "ticket_close_requests_ticket_id_fkey"
    FOREIGN KEY ("ticket_id") REFERENCES "service_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "ticket_close_requests_append_only"
    BEFORE UPDATE OR DELETE ON "ticket_close_requests"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();

CREATE TYPE "TicketCloseDecision" AS ENUM ('APPROVED', 'REJECTED');
CREATE TABLE "ticket_close_decisions" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "decision" "TicketCloseDecision" NOT NULL,
    "reason" TEXT,
    "decided_by_id" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_close_decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ticket_close_decisions_reason" CHECK (
        ("decision" = 'REJECTED') = ("reason" IS NOT NULL AND length(trim("reason")) > 0)
    )
);
CREATE UNIQUE INDEX "ticket_close_decisions_request_id_key" ON "ticket_close_decisions"("request_id");
ALTER TABLE "ticket_close_decisions" ADD CONSTRAINT "ticket_close_decisions_request_id_fkey"
    FOREIGN KEY ("request_id") REFERENCES "ticket_close_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "ticket_close_decisions_append_only"
    BEFORE UPDATE OR DELETE ON "ticket_close_decisions"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();
