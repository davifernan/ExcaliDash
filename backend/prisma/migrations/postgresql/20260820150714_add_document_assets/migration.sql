-- CreateTable
CREATE TABLE "StoredBlob" (
    "id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storedBytes" INTEGER NOT NULL,
    "contentEncoding" TEXT,
    "storageKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'STAGING',
    "deleteAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoredBlob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "blobId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "pageCount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "deleteAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawingAsset" (
    "drawingId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrawingAsset_pkey" PRIMARY KEY ("drawingId","assetId")
);

-- CreateTable
CREATE TABLE "DrawingSnapshotAsset" (
    "snapshotId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,

    CONSTRAINT "DrawingSnapshotAsset_pkey" PRIMARY KEY ("snapshotId","assetId")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoredBlob_sha256_key" ON "StoredBlob"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "StoredBlob_storageKey_key" ON "StoredBlob"("storageKey");

-- CreateIndex
CREATE INDEX "StoredBlob_state_deleteAfter_idx" ON "StoredBlob"("state", "deleteAfter");

-- CreateIndex
CREATE INDEX "Asset_ownerUserId_createdAt_idx" ON "Asset"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Asset_blobId_idx" ON "Asset"("blobId");

-- CreateIndex
CREATE INDEX "Asset_status_deleteAfter_idx" ON "Asset"("status", "deleteAfter");

-- CreateIndex
CREATE INDEX "DrawingAsset_assetId_idx" ON "DrawingAsset"("assetId");

-- CreateIndex
CREATE INDEX "DrawingAsset_state_expiresAt_idx" ON "DrawingAsset"("state", "expiresAt");

-- CreateIndex
CREATE INDEX "DrawingSnapshotAsset_assetId_idx" ON "DrawingSnapshotAsset"("assetId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_blobId_fkey" FOREIGN KEY ("blobId") REFERENCES "StoredBlob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingAsset" ADD CONSTRAINT "DrawingAsset_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingAsset" ADD CONSTRAINT "DrawingAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingSnapshotAsset" ADD CONSTRAINT "DrawingSnapshotAsset_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DrawingSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingSnapshotAsset" ADD CONSTRAINT "DrawingSnapshotAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

