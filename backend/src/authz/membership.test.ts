import { describe, expect, it, vi } from "vitest";
import { getDrawingMemberships } from "./membership";

const buildPrisma = (overrides: Record<string, any> = {}) => ({
  drawing: { findMany: vi.fn().mockResolvedValue([]) },
  drawingPermission: { findMany: vi.fn().mockResolvedValue([]) },
  collection: { findMany: vi.fn().mockResolvedValue([]) },
  collectionShare: { findMany: vi.fn().mockResolvedValue([]) },
  drawingLinkShare: { findFirst: vi.fn().mockResolvedValue({ permission: "edit" }) },
  ...overrides,
});

describe("drawing membership", () => {
  it("never turns a share link into membership", async () => {
    const prisma = buildPrisma({
      drawing: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "d1", userId: "someone-else", collectionId: null }]),
      },
    });

    const memberships = await getDrawingMemberships({
      prisma: prisma as any,
      userId: "outsider",
      drawingIds: ["d1"],
    });

    expect(memberships.get("d1")).toBeUndefined();
    expect(prisma.drawingLinkShare.findFirst).not.toHaveBeenCalled();
  });

  it("reports where each claim comes from and keeps the strongest level", async () => {
    const prisma = buildPrisma({
      drawing: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "d1", userId: "someone-else", collectionId: "c1" }]),
      },
      drawingPermission: {
        findMany: vi.fn().mockResolvedValue([{ drawingId: "d1", permission: "view" }]),
      },
      collectionShare: {
        findMany: vi.fn().mockResolvedValue([{ collectionId: "c1", role: "edit" }]),
      },
    });

    const membership = (
      await getDrawingMemberships({
        prisma: prisma as any,
        userId: "member",
        drawingIds: ["d1"],
      })
    ).get("d1");

    expect(membership?.level).toBe("edit");
    expect(membership?.sources).toEqual(["direct", "collection-share"]);
  });

  it("counts the collection owner as an owner of a board someone else created in it", async () => {
    const prisma = buildPrisma({
      drawing: {
        findMany: vi.fn().mockResolvedValue([{ id: "d1", userId: "editor", collectionId: "c1" }]),
      },
      collection: { findMany: vi.fn().mockResolvedValue([{ id: "c1" }]) },
    });

    const membership = (
      await getDrawingMemberships({
        prisma: prisma as any,
        userId: "collection-owner",
        drawingIds: ["d1"],
      })
    ).get("d1");

    expect(membership).toEqual({ level: "owner", sources: ["collection-owner"] });
  });

  it("asks the same four questions for one drawing as for many", async () => {
    const ids = Array.from({ length: 24 }, (_, index) => `d${index}`);
    const prisma = buildPrisma({
      drawing: {
        findMany: vi
          .fn()
          .mockResolvedValue(ids.map((id) => ({ id, userId: "me", collectionId: "c1" }))),
      },
    });

    const memberships = await getDrawingMemberships({
      prisma: prisma as any,
      userId: "me",
      drawingIds: [...ids, ...ids],
    });

    expect(memberships.size).toBe(24);
    expect(prisma.drawing.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.drawingPermission.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.collection.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.collectionShare.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.drawing.findMany.mock.calls[0][0].where.id.in).toHaveLength(24);
  });
});
