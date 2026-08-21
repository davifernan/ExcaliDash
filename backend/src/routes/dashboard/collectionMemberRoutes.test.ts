import express from "express";
import { describe, expect, it, vi } from "vitest";
import { registerCollectionMemberRoutes } from "./collectionMemberRoutes";

const invoke = async (app: express.Express, params: Record<string, string>, user: any) => {
  const layer = (app as any).router.stack.find(
    (candidate: any) => candidate.route?.path === "/collections/:id/members",
  );
  const req: any = { params, body: {}, query: {}, headers: {}, connection: {} };
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    set(key: string, value: string) {
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
  };
  (app as any).__user = user;
  for (const handlerLayer of layer.route.stack) {
    await handlerLayer.handle(req, res, () => undefined);
  }
  return res;
};

const buildApp = () => {
  const prisma: any = {
    collection: { findUnique: vi.fn().mockResolvedValue({ userId: "acct-olga" }) },
    collectionShare: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ granteeUserId: "acct-max", role: "edit" }]),
    },
    user: {
      findMany: vi.fn(async ({ where }: any) =>
        [
          { id: "acct-olga", name: "Owner Olga" },
          { id: "acct-max", name: "Member Max" },
        ].filter((row) => where.id.in.includes(row.id)),
      ),
    },
  };
  const app = express();
  registerCollectionMemberRoutes(app, {
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
    subjectKeySecret: "test-secret",
  } as any);
  return { app, prisma };
};

describe("collection members", () => {
  it("shows a member who else is in the collection, without addresses or ids", async () => {
    const { app } = buildApp();

    const res = await invoke(app, { id: "c1" }, { id: "acct-max" });

    expect(res.statusCode).toBe(200);
    expect(res.payload.members.map((m: any) => [m.name, m.role, m.isSelf])).toEqual([
      ["Owner Olga", "owner", false],
      ["Member Max", "editor", true],
    ]);
    const body = JSON.stringify(res.payload);
    expect(body).not.toContain("acct-olga");
    expect(body).not.toContain("acct-max");
    expect(body).not.toContain("@");
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
  });

  it("answers a stranger exactly as it answers a missing collection", async () => {
    const { app } = buildApp();

    const res = await invoke(app, { id: "c1" }, { id: "stranger" });

    expect(res.statusCode).toBe(404);
    expect(res.payload).toEqual({ error: "Collection not found" });
  });

  it("is not an agent endpoint", async () => {
    const { app } = buildApp();

    const res = await invoke(app, { id: "c1" }, { id: "acct-max", authCredentialType: "apiKey" });

    expect(res.statusCode).toBe(403);
  });

  it("gives the same person a different key in a different collection", async () => {
    const { app } = buildApp();

    const first = await invoke(app, { id: "c1" }, { id: "acct-max" });
    const second = await invoke(app, { id: "c2" }, { id: "acct-max" });

    expect(first.payload.members[0].subjectKey).not.toBe(second.payload.members[0].subjectKey);
  });
});
