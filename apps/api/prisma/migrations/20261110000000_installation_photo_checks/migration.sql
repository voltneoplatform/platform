-- Founder, 10 Nov 2026: an installation is recorded with a photo of each item
-- (battery, GPS device, vehicle, voltage reading, driver handover, other).
-- Head office checks each photo like a KYC document, then gives the final
-- approval that starts the agreement. Earlier photos count as OTHER.
CREATE TYPE "InstallationItem" AS ENUM ('BATTERY', 'GPS', 'VEHICLE', 'VOLTAGE', 'HANDOVER', 'OTHER');

ALTER TABLE "installation_photos" ADD COLUMN "item" "InstallationItem" NOT NULL DEFAULT 'OTHER';
ALTER TABLE "installation_photos" ALTER COLUMN "item" DROP DEFAULT;
ALTER TABLE "installation_photos" ADD COLUMN "uploaded_by_id" UUID;

CREATE TABLE "installation_photo_checks" (
    "id" UUID NOT NULL,
    "photo_id" UUID NOT NULL,
    "decision" "InstallationDecision" NOT NULL,
    "reason" TEXT,
    "decided_by_id" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installation_photo_checks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "installation_photo_checks_reason" CHECK (
        ("decision" = 'REJECTED') = ("reason" IS NOT NULL AND length(trim("reason")) > 0)
    )
);
CREATE UNIQUE INDEX "installation_photo_checks_photo_id_key" ON "installation_photo_checks"("photo_id");
ALTER TABLE "installation_photo_checks" ADD CONSTRAINT "installation_photo_checks_photo_id_fkey"
    FOREIGN KEY ("photo_id") REFERENCES "installation_photos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "installation_photo_checks_append_only"
    BEFORE UPDATE OR DELETE ON "installation_photo_checks"
    FOR EACH ROW EXECUTE FUNCTION "append_only_block_changes"();
