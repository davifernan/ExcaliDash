import express from "express";
import { describe, expect, it, vi } from "vitest";
import { registerCollectionRoutes } from "./collections";
import { registerDrawingSharingRoutes } from "./drawingSharingRoutes";

const asyncHandler = (handler: any) =>
  async (req: any, res: any, next: any) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };

const requireAuth = (req: any, _res: any, next: any) => {
  req.user = { id: "owner" };
  next();
};

const invokeDeleteRoute = async (
  app: express.Express,
  path: string,
  params: Record<string, string>,
) => {
  const layer = (app as any).router.stack.find(
    (candidate: any) =>
      candidate.route?.path === path && candidate.route.methods.delete,
  );
  const req: any = { params, body: {}, headers: {}, connection: {} };
  const res: any = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
  for (const handlerLayer of layer.route.stack) {
    await handlerLayer.handle(req, res, () => undefined);
  }
  return res;
};

describe("sharing route collaboration revocation", () => {
  it("rechecks the affected user after deleting a drawing permission", async () => {
    const recheckDrawingAccess = vi.fn().mockResolvedValue(undefined);
    const app = express();
    app.use(express.json());
    registerDrawingSharingRoutes(app, {
      prisma: {
        drawing: { findUnique: vi.fn().mockResolvedValue({ userId: "owner" }) },
        drawingPermission: {
          findFirst: vi.fn().mockResolvedValue({ granteeUserId: "viewer" }),
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      },
      requireAuth,
      asyncHandler,
      invalidateDrawingsCache: vi.fn(),
      collaborationAccess: {
        recheckDrawingAccess,
        recheckUserAccess: vi.fn(),
      },
      config: { enableAuditLogging: false },
    } as any);

    const response = await invokeDeleteRoute(
      app,
      "/drawings/:id/permissions/:permId",
      { id: "drawing-1", permId: "permission-1" },
    );

    expect(response.statusCode).toBe(200);
    expect(recheckDrawingAccess).toHaveBeenCalledWith("drawing-1", "viewer");
  });

  it("rechecks every drawing socket after revoking a public link", async () => {
    const recheckDrawingAccess = vi.fn().mockResolvedValue(undefined);
    const app = express();
    app.use(express.json());
    registerDrawingSharingRoutes(app, {
      prisma: {
        drawing: { findUnique: vi.fn().mockResolvedValue({ userId: "owner" }) },
        drawingLinkShare: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      },
      requireAuth,
      asyncHandler,
      invalidateDrawingsCache: vi.fn(),
      collaborationAccess: {
        recheckDrawingAccess,
        recheckUserAccess: vi.fn(),
      },
      config: { enableAuditLogging: false },
    } as any);

    const response = await invokeDeleteRoute(
      app,
      "/drawings/:id/link-shares/:shareId",
      { id: "drawing-1", shareId: "link-1" },
    );

    expect(response.statusCode).toBe(200);
    expect(recheckDrawingAccess).toHaveBeenCalledWith("drawing-1");
  });

  it("rechecks the affected user's active drawings after a collection revoke", async () => {
    const recheckUserAccess = vi.fn().mockResolvedValue(undefined);
    const app = express();
    app.use(express.json());
    registerCollectionRoutes(app, {
      prisma: {
        collection: { findFirst: vi.fn().mockResolvedValue({ id: "collection-1" }) },
        collectionShare: {
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      },
      requireAuth,
      asyncHandler,
      invalidateDrawingsCache: vi.fn(),
      collaborationAccess: {
        recheckDrawingAccess: vi.fn(),
        recheckUserAccess,
      },
      config: { enableAuditLogging: false },
    } as any);

    const response = await invokeDeleteRoute(
      app,
      "/collections/:id/shares/:userId",
      { id: "collection-1", userId: "viewer" },
    );

    expect(response.statusCode).toBe(200);
    expect(recheckUserAccess).toHaveBeenCalledWith("viewer");
  });
});
