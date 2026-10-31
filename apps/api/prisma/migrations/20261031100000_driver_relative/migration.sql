-- The driver's father's or husband's name, for the "son / daughter / wife of"
-- line of the printed agreement (founder, 31 Oct 2026). Recorded together or not at all.
CREATE TYPE "RelativeRelation" AS ENUM ('SON_OF', 'DAUGHTER_OF', 'WIFE_OF');

ALTER TABLE "drivers" ADD COLUMN "relative_relation" "RelativeRelation",
    ADD COLUMN "relative_name" TEXT;

ALTER TABLE "drivers" ADD CONSTRAINT "drivers_relative_complete" CHECK (
    ("relative_relation" IS NULL) = ("relative_name" IS NULL)
);
