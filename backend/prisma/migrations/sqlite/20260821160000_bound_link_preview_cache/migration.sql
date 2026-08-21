ALTER TABLE "LinkPreview" ADD COLUMN "ownerUserId" TEXT;
-- SQLite refuses a non-constant default on ADD COLUMN as soon as the table has
-- rows, because it has to write a value into each one. CURRENT_TIMESTAMP is
-- such a default: this migration would apply on an empty table and fail on a
-- database that already holds previews. A constant default is accepted, and the
-- existing rows are then given a real timestamp of their own.
ALTER TABLE "LinkPreview" ADD COLUMN "lastAccessedAt" DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00';
UPDATE "LinkPreview" SET "lastAccessedAt" = CURRENT_TIMESTAMP;

CREATE INDEX "LinkPreview_ownerUserId_lastAccessedAt_idx" ON "LinkPreview"("ownerUserId", "lastAccessedAt");
CREATE INDEX "LinkPreview_lastAccessedAt_idx" ON "LinkPreview"("lastAccessedAt");

ALTER TABLE "StoredBlob" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'ASSET';
CREATE INDEX "StoredBlob_purpose_createdAt_idx" ON "StoredBlob"("purpose", "createdAt");
