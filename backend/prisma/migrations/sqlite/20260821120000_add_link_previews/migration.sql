-- CreateTable
CREATE TABLE "LinkPreview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cacheKey" TEXT NOT NULL,
    "requestedUrl" TEXT NOT NULL,
    "resolvedUrl" TEXT,
    "status" TEXT NOT NULL,
    "failureCode" TEXT,
    "title" TEXT,
    "description" TEXT,
    "imageBlobId" TEXT,
    "faviconBlobId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LinkPreview_imageBlobId_fkey" FOREIGN KEY ("imageBlobId") REFERENCES "StoredBlob" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LinkPreview_faviconBlobId_fkey" FOREIGN KEY ("faviconBlobId") REFERENCES "StoredBlob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LinkPreview_cacheKey_key" ON "LinkPreview"("cacheKey");
CREATE INDEX "LinkPreview_expiresAt_idx" ON "LinkPreview"("expiresAt");
CREATE INDEX "LinkPreview_imageBlobId_idx" ON "LinkPreview"("imageBlobId");
CREATE INDEX "LinkPreview_faviconBlobId_idx" ON "LinkPreview"("faviconBlobId");
