import express from "express";
import { describe, expect, it, vi } from "vitest";
import { registerCollectionRoutes } from "./collections";

const invoke = async (
  app: express.Express,
  method: "get" | "post",
  path: string,
  params: Record<string, string> = {},
  body: Record<string, unknown> = {},
) => {
  const layer = (app as any).router.stack.find(
    (candidate: any) => candidate.route?.path === path && candidate.route.methods[method],
  );
  const req: any = { params, body, query: {}, headers: {}, connection: {}, ip: "127.0.0.1" };
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

const accounts = [
  { id: "alex-one", name: "Alex", email: "alex.one@example.com", username: "alexone" },
  { id: "alex-two", name: "Alex", email: "alex.two@example.com", username: "alextwo" },
];

const buildApp = () => {
  const prisma: any = {
    collection: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(async ({ where }: any) =>
        where.userId === "owner" ? { id: "collection-1", name: "Team" } : null,
      ),
    },
    collectionShare: {
      groupBy: vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([
        {
          role: "edit",
          collection: {
            id: "collection-1",
            name: "Team",
            createdAt: new Date(0),
            updatedAt: new Date(0),
            userId: "owner",
            user: { name: "Owner Olga", email: "owner@example.com" },
          },
        },
      ]),
      upsert: vi.fn(async ({ create }: any) => ({
        ...create,
        granteeUser: { id: create.granteeUserId },
      })),
    },
    user: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.id) return accounts.find((account) => account.id === where.id) ?? null;
        const clauses = where.OR || [];
        return (
          accounts.find((account) =>
            clauses.some(
              (clause: any) =>
                (clause.email && clause.email === account.email) ||
                (clause.username && clause.username === account.username),
            ),
          ) ?? null
        );
      }),
    },
  };
  const app = express();
  registerCollectionRoutes(app, {
    prisma,
    requireAuth: (req: any, _res: any, next: any) => {
      req.user = { id: "owner" };
      next();
    },
    asyncHandler: (handler: any) => async (req: any, res: any, next: any) => {
      try {
        await handler(req, res, next);
      } catch (error) {
        next(error);
      }
    },
    collectionNameSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
    sanitizeText: (value: string) => value,
    ensureTrashCollection: vi.fn(),
    invalidateDrawingsCache: vi.fn(),
    collaborationAccess: { recheckUserAccess: vi.fn(), recheckDrawingAccess: vi.fn() },
    config: { enableAuditLogging: false },
    logAuditEvent: vi.fn(),
  } as any);
  return { app, prisma };
};

describe("sharing a collection", () => {
  it("refuses to guess which of two people with the same name was meant", async () => {
    const { app } = buildApp();

    const res = await invoke(
      app,
      "post",
      "/collections/:id/shares",
      { id: "collection-1" },
      { identifier: "Alex", role: "edit" },
    );

    expect(res.statusCode).toBe(404);
  });

  it("shares with the account that was actually picked", async () => {
    const { app, prisma } = buildApp();

    const res = await invoke(
      app,
      "post",
      "/collections/:id/shares",
      { id: "collection-1" },
      { granteeUserId: "alex-two", role: "edit" },
    );

    expect(res.statusCode).toBe(200);
    expect(prisma.collectionShare.upsert.mock.calls[0][0].create.granteeUserId).toBe("alex-two");
  });

  it("still accepts an unambiguous email", async () => {
    const { app, prisma } = buildApp();

    await invoke(
      app,
      "post",
      "/collections/:id/shares",
      { id: "collection-1" },
      { identifier: "alex.one@example.com", role: "view" },
    );

    expect(prisma.collectionShare.upsert.mock.calls[0][0].create.granteeUserId).toBe("alex-one");
  });

  it("does not hand the owner's email to everyone it is shared with", async () => {
    const { app } = buildApp();

    const res = await invoke(app, "get", "/collections");

    expect(JSON.stringify(res.payload)).not.toContain("owner@example.com");
    expect(res.payload[0]).toMatchObject({ ownerName: "Owner Olga", isOwner: false });
  });
});
