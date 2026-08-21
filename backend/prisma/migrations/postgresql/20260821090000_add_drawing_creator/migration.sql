-- Who drew a board, kept apart from who controls it.
-- Every existing board was drawn by its owner as far as the database knows, so
-- that is what the column starts as. Moving control of team boards to the
-- collection owner is a separate, reported step.
ALTER TABLE "Drawing" ADD COLUMN "createdByUserId" TEXT;

ALTER TABLE "Drawing" ADD CONSTRAINT "Drawing_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Drawing_createdByUserId_idx" ON "Drawing"("createdByUserId");

UPDATE "Drawing" SET "createdByUserId" = "userId" WHERE "createdByUserId" IS NULL;
