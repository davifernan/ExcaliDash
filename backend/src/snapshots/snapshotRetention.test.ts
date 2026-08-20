import { describe, expect, it, vi } from "vitest";
import { pruneDrawingSnapshots } from "./snapshotRetention";

describe("snapshot count retention", () => {
  it("deletes every snapshot beyond the per-drawing ceiling", async () => {
    const stale = [{ id: "old-1" }, { id: "old-2" }];
    const prisma = {
      drawingSnapshot: {
        findMany: vi.fn().mockResolvedValue(stale),
        deleteMany: vi.fn().mockResolvedValue({ count: stale.length }),
      },
    };

    await expect(pruneDrawingSnapshots(prisma, "drawing-1", 100)).resolves.toBe(2);
    expect(prisma.drawingSnapshot.findMany).toHaveBeenCalledWith({
      where: { drawingId: "drawing-1" },
      select: { id: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 100,
    });
    expect(prisma.drawingSnapshot.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["old-1", "old-2"] } },
    });
  });
});
