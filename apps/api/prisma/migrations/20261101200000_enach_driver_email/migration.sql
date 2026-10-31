-- Founder, 31 Oct 2026: e-NACH (bank account) as a second AutoPay method, and an
-- optional email address for drivers (used on mandates and for emailed receipts).
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'ENACH';

CREATE TYPE "AutopayMethod" AS ENUM ('UPI', 'ENACH');
ALTER TABLE "autopay_mandates" ADD COLUMN "method" "AutopayMethod" NOT NULL DEFAULT 'UPI';

ALTER TABLE "drivers" ADD COLUMN "email" TEXT;
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_email_lowercase" CHECK ("email" IS NULL OR "email" = lower("email"));

ALTER TYPE "MessageChannel" ADD VALUE IF NOT EXISTS 'EMAIL';
ALTER TABLE "outbound_messages" ADD COLUMN "to_email" TEXT;
