-- Driver App sign-in (M6): a code sent to the driver's phone, then rotating
-- refresh-token sessions like staff sessions. A phone may belong to more than
-- one driver (shared phones), so codes are kept per phone, not per driver.
CREATE TABLE "driver_otp_challenges" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "request_ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_otp_challenges_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "driver_otp_challenges_phone_created_at_idx" ON "driver_otp_challenges"("phone", "created_at");

CREATE TABLE "driver_sessions" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "rotated_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,

    CONSTRAINT "driver_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "driver_sessions_refresh_token_hash_key" ON "driver_sessions"("refresh_token_hash");
CREATE INDEX "driver_sessions_driver_id_idx" ON "driver_sessions"("driver_id");
CREATE INDEX "driver_sessions_family_id_idx" ON "driver_sessions"("family_id");
ALTER TABLE "driver_sessions" ADD CONSTRAINT "driver_sessions_driver_id_fkey"
    FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
