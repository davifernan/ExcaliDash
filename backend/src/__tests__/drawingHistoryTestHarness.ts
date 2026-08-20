import express from "express";
import { vi } from "vitest";
import { registerDrawingRoutes } from "../routes/dashboard/drawings";

const MOCK_USER_ID = "user-1";
export const MOCK_DRAWING_ID = "drawing-1";
export const MOCK_SNAPSHOT_ID = "snapshot-1";

export const mockDrawing = {
  id: MOCK_DRAWING_ID,
  name: "Test Drawing",
  elements: JSON.stringify([{ id: "el-1", type: "rectangle" }]),
  appState: JSON.stringify({ viewBackgroundColor: "#ffffff" }),
  files: "{}",
  version: 5,
  userId: MOCK_USER_ID,
  collectionId: null,
  preview: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const mockSnapshot = {
  id: MOCK_SNAPSHOT_ID,
  drawingId: MOCK_DRAWING_ID,
  version: 4,
  elements: JSON.stringify([{ id: "el-old", type: "ellipse" }]),
  appState: JSON.stringify({ viewBackgroundColor: "#eeeeee" }),
  files: "{}",
  createdAt: new Date("2026-04-15T10:00:00Z"),
};

export function buildApp() {
  const prisma: any = {
    drawing: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    drawingSnapshot: {
      create: vi.fn().mockResolvedValue({ id: "backup-snapshot" }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    drawingSnapshotAsset: {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    drawingAsset: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ isActive: true }) },
    drawingPermission: { findMany: vi.fn().mockResolvedValue([]) },
    drawingLinkShare: { findMany: vi.fn().mockResolvedValue([]) },
    collection: { findFirst: vi.fn() },
  };
  prisma.$transaction = vi.fn(async (callback: (tx: any) => unknown) => callback(prisma));
  const emit = vi.fn();
  const io = { to: vi.fn(() => ({ emit })) };

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: MOCK_USER_ID, role: "USER" };
    next();
  });

  registerDrawingRoutes(app, {
    prisma,
    requireAuth: (_req: any, _res: any, next: any) => next(),
    optionalAuth: (_req: any, _res: any, next: any) => next(),
    asyncHandler: (fn: any) => (req: any, res: any, next: any) =>
      Promise.resolve(fn(req, res, next)).catch(next),
    parseJsonField: (val: string, fallback: any) => {
      try {
        return JSON.parse(val);
      } catch {
        return fallback;
      }
    },
    sanitizeText: (input: unknown) => String(input ?? ""),
    validateImportedDrawing: vi.fn().mockReturnValue(true),
    drawingCreateSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: {} }) } as any,
    drawingUpdateSchema: { safeParse: vi.fn() } as any,
    respondWithValidationErrors: vi.fn(),
    collectionNameSchema: { safeParse: vi.fn() } as any,
    ensureTrashCollection: vi.fn(),
    invalidateDrawingsCache: vi.fn(),
    io,
    buildDrawingsCacheKey: vi.fn(),
    getCachedDrawingsBody: vi.fn().mockReturnValue(null),
    cacheDrawingsResponse: vi.fn(),
    MAX_PAGE_SIZE: 100,
    config: {
      nodeEnv: "test",
      enableAuditLogging: false,
      enableSnapshotCompression: true,
      snapshotMaxCountPerDrawing: 100,
    },
    logAuditEvent: vi.fn(),
  } as any);

  return { app, prisma, io, emit };
}
