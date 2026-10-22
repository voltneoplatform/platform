-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('SUPER_ADMIN', 'PLAN_MANAGER', 'OPERATIONS_MANAGER', 'FINANCE', 'SUPPORT', 'FIELD_AGENT', 'TECHNICIAN', 'RECOVERY');

-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "OtpChannel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "SessionClient" AS ENUM ('WEB', 'APP');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('STAFF', 'DRIVER', 'SYSTEM');

-- CreateTable
CREATE TABLE "staff_users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" "StaffRole" NOT NULL,
    "status" "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(3),
    "deactivated_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_otp_challenges" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "channel" "OtpChannel" NOT NULL,
    "destination" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "request_ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_sessions" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "client" "SessionClient" NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "rotated_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,

    CONSTRAINT "staff_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "record_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "request_id" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_email_key" ON "staff_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_phone_key" ON "staff_users"("phone");

-- CreateIndex
CREATE INDEX "staff_otp_challenges_staff_id_created_at_idx" ON "staff_otp_challenges"("staff_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_sessions_refresh_token_hash_key" ON "staff_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "staff_sessions_staff_id_idx" ON "staff_sessions"("staff_id");

-- CreateIndex
CREATE INDEX "staff_sessions_family_id_idx" ON "staff_sessions"("family_id");

-- CreateIndex
CREATE INDEX "audit_log_table_name_record_id_idx" ON "audit_log"("table_name", "record_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_at_idx" ON "audit_log"("actor_id", "at");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- AddForeignKey
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_otp_challenges" ADD CONSTRAINT "staff_otp_challenges_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules Prisma cannot express in the schema (kept by hand)
-- ---------------------------------------------------------------------------

-- Every staff member needs at least one way to receive a login code.
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_contact_present"
    CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL);

-- Emails are stored lower-case so uniqueness is case-insensitive.
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_email_lowercase"
    CHECK ("email" IS NULL OR "email" = lower("email"));

-- Phones are stored as +91 followed by a 10-digit Indian mobile number.
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_phone_e164_in"
    CHECK ("phone" IS NULL OR "phone" ~ '^\+91[6-9][0-9]{9}$');

-- The audit log is append-only (Platform MVP Spec V1, section 3, rule 17).
CREATE FUNCTION "audit_log_block_changes"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_log_no_update"
    BEFORE UPDATE OR DELETE ON "audit_log"
    FOR EACH ROW EXECUTE FUNCTION "audit_log_block_changes"();

CREATE TRIGGER "audit_log_no_truncate"
    BEFORE TRUNCATE ON "audit_log"
    FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_block_changes"();
