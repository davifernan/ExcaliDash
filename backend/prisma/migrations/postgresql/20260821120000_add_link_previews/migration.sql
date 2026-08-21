-- CreateTable
CREATE TABLE "LinkPreview" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "requestedUrl" TEXT NOT NULL,
    "resolvedUrl" TEXT,
    "status" TEXT NOT NULL,
    "failureCode" TEXT,
    "title" TEXT,
    "description" TEXT,
    "imageBlobId" TEXT,
    "faviconBlobId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkPreview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LinkPreview_cacheKey_key" ON "LinkPreview"("cacheKey");
CREATE INDEX "LinkPreview_expiresAt_idx" ON "LinkPreview"("expiresAt");
CREATE INDEX "LinkPreview_imageBlobId_idx" ON "LinkPreview"("imageBlobId");
CREATE INDEX "LinkPreview_faviconBlobId_idx" ON "LinkPreview"("faviconBlobId");

ALTER TABLE "LinkPreview" ADD CONSTRAINT "LinkPreview_imageBlobId_fkey" FOREIGN KEY ("imageBlobId") REFERENCES "StoredBlob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LinkPreview" ADD CONSTRAINT "LinkPreview_faviconBlobId_fkey" FOREIGN KEY ("faviconBlobId") REFERENCES "StoredBlob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
