ALTER TABLE "LinkPreview" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "LinkPreview" ADD COLUMN "lastAccessedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "LinkPreview_ownerUserId_lastAccessedAt_idx" ON "LinkPreview"("ownerUserId", "lastAccessedAt");
CREATE INDEX "LinkPreview_lastAccessedAt_idx" ON "LinkPreview"("lastAccessedAt");

ALTER TABLE "StoredBlob" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'ASSET';
CREATE INDEX "StoredBlob_purpose_createdAt_idx" ON "StoredBlob"("purpose", "createdAt");
