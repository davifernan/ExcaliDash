-- Which page of a document the room is looking at.
--
-- Kept beside the board rather than inside it: turning a page must not bump an
-- element version, land in undo history, or collide with somebody drawing at
-- the same moment. One row per widget, so the same file placed twice can show
-- two different pages.
--
-- elementId is not a foreign key. Elements live inside the board JSON, so there
-- is no table to point at; a board that loses a widget leaves a row nothing
-- reads, which the per-board cap keeps harmless.

-- CreateTable
CREATE TABLE "DocumentPageView" (
    "drawingId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentPageView_pkey" PRIMARY KEY ("drawingId","elementId")
);

-- CreateIndex
CREATE INDEX "DocumentPageView_assetId_idx" ON "DocumentPageView"("assetId");

-- AddForeignKey
ALTER TABLE "DocumentPageView" ADD CONSTRAINT "DocumentPageView_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPageView" ADD CONSTRAINT "DocumentPageView_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
