import { describe, expect, it, vi } from "vitest";
import { getDrawingAccess } from "./sharing";

describe("drawing account status", () => {
  it("denies an inactive owner even when the drawing also has an edit link", async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ isActive: false }),
      },
      drawing: {
        findUnique: vi.fn().mockResolvedValue({ userId: "inactive-owner" }),
      },
      drawingLinkShare: {
        findFirst: vi.fn().mockResolvedValue({ permission: "edit" }),
      },
    };

    await expect(
      getDrawingAccess({
        prisma: prisma as any,
        principal: { kind: "user", userId: "inactive-owner" },
        drawingId: "drawing-1",
      }),
    ).resolves.toBe("none");
    expect(prisma.drawing.findUnique).not.toHaveBeenCalled();
    expect(prisma.drawingLinkShare.findFirst).not.toHaveBeenCalled();
  });

  it("keeps the inactive bootstrap identity usable only with the explicit bypass", async () => {
    const prisma = {
      user: { findUnique: vi.fn() },
      drawing: {
        findUnique: vi.fn().mockResolvedValue({ userId: "bootstrap-admin" }),
      },
      drawingLinkShare: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    await expect(
      getDrawingAccess({
        prisma: prisma as any,
        principal: {
          kind: "user",
          userId: "bootstrap-admin",
          allowInactive: true,
        },
        drawingId: "drawing-1",
      }),
    ).resolves.toBe("owner");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
