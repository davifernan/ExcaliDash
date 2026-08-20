-- CreateTable
CREATE TABLE "StoredBlob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storedBytes" INTEGER NOT NULL,
    "contentEncoding" TEXT,
    "storageKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'STAGING',
    "deleteAfter" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "blobId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "pageCount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "deleteAfter" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Asset_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Asset_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Asset_blobId_fkey" FOREIGN KEY ("blobId") REFERENCES "StoredBlob" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DrawingAsset" (
    "drawingId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("drawingId", "assetId"),
    CONSTRAINT "DrawingAsset_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DrawingAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DrawingSnapshotAsset" (
    "snapshotId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,

    PRIMARY KEY ("snapshotId", "assetId"),
    CONSTRAINT "DrawingSnapshotAsset_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DrawingSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DrawingSnapshotAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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

