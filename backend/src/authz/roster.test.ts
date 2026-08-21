import { describe, expect, it, vi } from "vitest";
import { getCollectionRoster, getDrawingRosters } from "./roster";

const users = [
  { id: "owner", name: "Owner Olga" },
  { id: "editor", name: "Editor Emil" },
  { id: "viewer", name: "Viewer Vera" },
  { id: "col-owner", name: "Collection Carla" },
];

const buildPrisma = (overrides: Record<string, any> = {}) => ({
  drawing: { findMany: vi.fn().mockResolvedValue([]) },
  drawingPermission: { findMany: vi.fn().mockResolvedValue([]) },
  collection: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
  collectionShare: { findMany: vi.fn().mockResolvedValue([]) },
  drawingLinkShare: { findMany: vi.fn(), findFirst: vi.fn() },
  user: {
    findMany: vi.fn(({ where }: any) =>
      Promise.resolve(users.filter((user) => where.id.in.includes(user.id))),
    ),
  },
  ...overrides,
});

describe("drawing roster", () => {
  it("merges the collection into the board and keeps the strongest claim", async () => {
    const prisma = buildPrisma({
      drawing: {
        findMany: vi.fn().mockResolvedValue([{ id: "d1", userId: "owner", collectionId: "c1" }]),
      },
      collection: { findMany: vi.fn().mockResolvedValue([{ id: "c1", userId: "col-owner" }]) },
      collectionShare: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ collectionId: "c1", granteeUserId: "viewer", role: "view" }]),
      },
      drawingPermission: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ drawingId: "d1", granteeUserId: "viewer", permission: "edit" }]),
      },
    });

    const roster = (await getDrawingRosters({ prisma: prisma as any, drawingIds: ["d1"] })).get(
      "d1",
    );

    expect(roster?.map((member) => [member.userId, member.level])).toEqual([
      ["col-owner", "owner"],
      ["owner", "owner"],
      ["viewer", "edit"],
    ]);
  });

  it("never asks about link shares", async () => {
    const prisma = buildPrisma({
      drawing: {
        findMany: vi.fn().mockResolvedValue([{ id: "d1", userId: "owner", collectionId: null }]),
      },
    });
    await getDrawingRosters({ prisma: prisma as any, drawingIds: ["d1"] });
    expect(prisma.drawingLinkShare.findMany).not.toHaveBeenCalled();
    expect(prisma.drawingLinkShare.findFirst).not.toHaveBeenCalled();
  });

  it("drops a deactivated account instead of listing a name it no longer trusts", async () => {
    const prisma = buildPrisma({
      drawing: {
        findMany: vi.fn().mockResolvedValue([{ id: "d1", userId: "owner", collectionId: null }]),
      },
      drawingPermission: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ drawingId: "d1", granteeUserId: "gone", permission: "edit" }]),
      },
    });

    const roster = (await getDrawingRosters({ prisma: prisma as any, drawingIds: ["d1"] })).get(
      "d1",
    );

    expect(roster?.map((member) => member.userId)).toEqual(["owner"]);
    expect(prisma.user.findMany.mock.calls[0][0].where.isActive).toBe(true);
  });

  it("reads names once for a whole page", async () => {
    const ids = Array.from({ length: 24 }, (_, index) => `d${index}`);
    const prisma = buildPrisma({
      drawing: {
        findMany: vi
          .fn()
          .mockResolvedValue(ids.map((id) => ({ id, userId: "owner", collectionId: null }))),
      },
    });

    const rosters = await getDrawingRosters({ prisma: prisma as any, drawingIds: ids });

    expect(rosters.size).toBe(24);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
  });

  it("puts the collection owner at the top of a collection roster", async () => {
    const prisma = buildPrisma({
      collection: {
        findMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ userId: "col-owner" }),
      },
      collectionShare: {
        findMany: vi.fn().mockResolvedValue([
          { collectionId: "c1", granteeUserId: "editor", role: "edit" },
          { collectionId: "c1", granteeUserId: "viewer", role: "view" },
        ]),
      },
    });

    const roster = await getCollectionRoster({ prisma: prisma as any, collectionId: "c1" });

    expect(roster.map((member) => [member.name, member.level])).toEqual([
      ["Collection Carla", "owner"],
      ["Editor Emil", "edit"],
      ["Viewer Vera", "view"],
    ]);
  });
});
