import express from "express";
import { describe, expect, it, vi } from "vitest";
import { registerDrawingListRoutes } from "./drawingListRoutes";

const invoke = async (app: express.Express, user: any) => {
  const layer = (app as any).router.stack.find(
    (candidate: any) => candidate.route?.path === "/drawings" && candidate.route.methods.get,
  );
  const req: any = { params: {}, body: {}, query: {}, headers: {}, connection: {} };
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(key: string, value: string) {
      this.headers[key] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
    send(payload: Buffer | string) {
      this.payload = JSON.parse(payload.toString());
      return this;
    },
  };
  (app as any).__user = user;
  for (const handlerLayer of layer.route.stack) {
    await handlerLayer.handle(req, res, () => undefined);
  }
  return res;
};

const buildApp = () => {
  const drawing = {
    id: "drawing-1",
    name: "Board",
    collectionId: null,
    userId: "account-1",
    version: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    user: { id: "account-1", name: "Owner" },
    createdBy: { name: "Owner" },
  };
  const prisma: any = {
    drawing: {
      findMany: vi.fn().mockResolvedValue([drawing]),
      count: vi.fn().mockResolvedValue(1),
    },
    drawingPermission: { findMany: vi.fn().mockResolvedValue([]) },
    collection: { findMany: vi.fn().mockResolvedValue([]) },
    collectionShare: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([{ id: "account-1", name: "Owner" }]) },
  };
  const cache = new Map<string, Buffer>();
  const app = express();
  registerDrawingListRoutes(app, {
    prisma,
    requireAuth: (req: any, _res: any, next: any) => {
      req.user = (app as any).__user;
      next();
    },
    asyncHandler: (handler: any) => async (req: any, res: any, next: any) => {
      try {
        await handler(req, res, next);
      } catch (error) {
        next(error);
      }
    },
    parseJsonField: (_value: unknown, fallback: unknown) => fallback,
    subjectKeySecret: "test-secret",
    buildDrawingsCacheKey: ({ userId }: any) => `drawings:${userId}`,
    getCachedDrawingsBody: (key: string) => cache.get(key) ?? null,
    cacheDrawingsResponse: (key: string, payload: unknown) => {
      const body = Buffer.from(JSON.stringify(payload));
      cache.set(key, body);
      return body;
    },
    MAX_PAGE_SIZE: 100,
  } as any);
  return app;
};

describe("drawing list member projection", () => {
  it("does not expose the member roster to an API key or through its account cache", async () => {
    const app = buildApp();

    const browser = await invoke(app, { id: "account-1", authCredentialType: "jwt" });
    expect(browser.payload.drawings[0].members.totalCount).toBe(1);

    const apiKey = await invoke(app, { id: "account-1", authCredentialType: "apiKey" });
    expect(apiKey.statusCode).toBe(200);
    expect(apiKey.payload.drawings[0]).not.toHaveProperty("members");
  });
});
