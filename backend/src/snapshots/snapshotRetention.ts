/**
 * Keep version history useful without allowing a busy board to copy its full
 * scene an unbounded number of times inside the time-based retention window.
 */
export async function pruneDrawingSnapshots(
  prisma: any,
  drawingId: string,
  maxCount: number,
): Promise<number> {
  const keep = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 100;
  const stale = await prisma.drawingSnapshot.findMany({
    where: { drawingId },
    select: { id: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: keep,
  });
  if (stale.length === 0) return 0;
  const removed = await prisma.drawingSnapshot.deleteMany({
    where: { id: { in: stale.map((snapshot: { id: string }) => snapshot.id) } },
  });
  return removed.count;
}
