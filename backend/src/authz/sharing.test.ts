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

  it("does not let a narrow direct share hide a wider inherited one", async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ isActive: true }) },
      drawing: {
        findUnique: vi.fn().mockResolvedValue({ userId: "someone-else", collectionId: "c1" }),
      },
      drawingPermission: { findUnique: vi.fn().mockResolvedValue({ permission: "view" }) },
      collection: { findFirst: vi.fn().mockResolvedValue(null) },
      collectionShare: { findFirst: vi.fn().mockResolvedValue({ role: "edit" }) },
      drawingLinkShare: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    await expect(
      getDrawingAccess({
        prisma: prisma as any,
        principal: { kind: "user", userId: "member" },
        drawingId: "drawing-1",
      }),
    ).resolves.toBe("edit");
  });

  it("still lets the collection owner control a board created in their collection", async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ isActive: true }) },
      drawing: {
        findUnique: vi.fn().mockResolvedValue({ userId: "editor", collectionId: "c1" }),
      },
      drawingPermission: { findUnique: vi.fn().mockResolvedValue({ permission: "view" }) },
      collection: { findFirst: vi.fn().mockResolvedValue({ id: "c1" }) },
      collectionShare: { findFirst: vi.fn() },
      drawingLinkShare: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    await expect(
      getDrawingAccess({
        prisma: prisma as any,
        principal: { kind: "user", userId: "collection-owner" },
        drawingId: "drawing-1",
      }),
    ).resolves.toBe("owner");
  });

  it("reads the drawing row once", async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ isActive: true }) },
      drawing: {
        findUnique: vi.fn().mockResolvedValue({ userId: "someone-else", collectionId: null }),
      },
      drawingPermission: { findUnique: vi.fn().mockResolvedValue(null) },
      collection: { findFirst: vi.fn() },
      collectionShare: { findFirst: vi.fn() },
      drawingLinkShare: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    await getDrawingAccess({
      prisma: prisma as any,
      principal: { kind: "user", userId: "outsider" },
      drawingId: "drawing-1",
    });

    expect(prisma.drawing.findUnique).toHaveBeenCalledTimes(1);
  });
});
