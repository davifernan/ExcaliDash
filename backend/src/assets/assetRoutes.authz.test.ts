import express from "express";
import { describe, expect, it, vi } from "vitest";
import { registerAssetRoutes } from "./assetRoutes";

const DRAWING_ID = "drawing-1";
const ASSET_ID = "asset-1";

const invokeMetadataRoute = async (app: express.Express) => {
  const layer = (app as any).router.stack.find(
    (candidate: any) =>
      candidate.route?.path === "/drawings/:drawingId/assets/:assetId" &&
      candidate.route.methods.get,
  );
  const req: any = {
    method: "GET",
    params: { drawingId: DRAWING_ID, assetId: ASSET_ID },
    query: {},
    headers: {},
  };
  const res: any = {
    statusCode: 200,
    headers: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
  for (const handler of layer.route.stack) {
    await handler.handle(req, res, () => undefined);
  }
  return res;
};

const buildViewerHarness = (drawingAsset: { state: string } | null) => {
  const prisma: any = {
    user: { findUnique: vi.fn().mockResolvedValue({ isActive: true }) },
    drawing: { findUnique: vi.fn().mockResolvedValue({ userId: "owner-1" }) },
    drawingPermission: {
      findUnique: vi.fn().mockResolvedValue({ permission: "view" }),
    },
    drawingAsset: { findUnique: vi.fn().mockResolvedValue(drawingAsset) },
    drawingSnapshotAsset: {
      findFirst: vi.fn().mockResolvedValue({ assetId: ASSET_ID }),
    },
    asset: {
      findUnique: vi.fn().mockResolvedValue({
        id: ASSET_ID,
        kind: "PDF",
        originalName: "board.pdf",
        pageCount: 2,
        status: "READY",
        blob: { sizeBytes: 100 },
      }),
    },
  };
  const app = express();
  registerAssetRoutes({
    app,
    prisma,
    requireAuth: (_req: any, _res: any, next: any) => next(),
    optionalAuth: (req: any, _res: any, next: any) => {
      req.user = { id: "viewer-1" };
      next();
    },
    asyncHandler: (fn: any) => (req: any, res: any, next: any) =>
      Promise.resolve(fn(req, res, next)).catch(next),
    storageDir: ".",
    maxUploadBytes: 1,
    maxPerUserBytes: 1,
    getPage: vi.fn(),
    describeUpload: vi.fn(),
  });
  return { app, prisma };
};

describe("document route view authorization", () => {
  it("lets a view-only user fetch an asset referenced by the live drawing", async () => {
    const { app, prisma } = buildViewerHarness({ state: "ACTIVE" });

    const response = await invokeMetadataRoute(app);

    expect(response.statusCode).toBe(200);
    expect(response.payload.id).toBe(ASSET_ID);
    expect(prisma.drawingSnapshotAsset.findFirst).not.toHaveBeenCalled();
  });

  it("hides an asset retained only by a historical snapshot from a view-only user", async () => {
    const { app, prisma } = buildViewerHarness(null);

    const response = await invokeMetadataRoute(app);

    expect(response.statusCode).toBe(404);
    expect(response.payload.error).toBe("Document not found");
    expect(prisma.asset.findUnique).not.toHaveBeenCalled();
  });
});
