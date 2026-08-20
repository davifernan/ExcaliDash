import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerApiKeySocketRevoker,
  registerUserSocketRechecker,
} from "../server/socketRevocation";
import { registerAdminUserRoutes } from "./adminUserRoutes";

describe("admin account deactivation", () => {
  afterEach(() => {
    registerApiKeySocketRevoker(async () => undefined);
    registerUserSocketRechecker(async () => undefined);
  });

  it("revokes stored credentials and disconnects user and API-key sockets before responding", async () => {
    const recheckUserSockets = vi.fn().mockResolvedValue(undefined);
    const disconnectApiKey = vi.fn().mockResolvedValue(undefined);
    registerUserSocketRechecker(recheckUserSockets);
    registerApiKeySocketRevoker(disconnectApiKey);

    const prisma: any = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "member",
          role: "USER",
          isActive: true,
        }),
        update: vi.fn().mockResolvedValue({
          id: "member",
          username: "member",
          email: "member@example.test",
          name: "Member",
          role: "USER",
          mustResetPassword: false,
          isActive: false,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        }),
      },
      refreshToken: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      apiKey: {
        findMany: vi.fn().mockResolvedValue([{ id: "member-api-key" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.$transaction = vi.fn(async (callback: (tx: any) => unknown) =>
      callback(prisma),
    );

    const router = express.Router();
    registerAdminUserRoutes({
      router,
      prisma,
      requireAuth: ((req: any, _res: any, next: any) => {
        req.user = { id: "admin", role: "ADMIN" };
        next();
      }) as any,
      accountActionRateLimiter: ((_req: any, _res: any, next: any) =>
        next()) as any,
      ensureAuthEnabled: async () => true,
      requireCsrf: () => true,
      requireAdmin: () => true,
      countActiveAdmins: async () => 2,
      sanitizeText: (value: unknown) => String(value),
      config: { enableAuditLogging: false },
    } as any);
    const layer = (router as any).stack.find(
      (candidate: any) =>
        candidate.route?.path === "/users/:id" &&
        candidate.route.methods.patch,
    );
    const req: any = {
      params: { id: "member" },
      body: { isActive: false },
      headers: {},
      connection: {},
    };
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
    for (const handler of layer.route.stack) {
      await handler.handle(req, res, () => undefined);
    }

    expect(res.statusCode).toBe(200);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "member", revoked: false },
      data: { revoked: true },
    });
    expect(prisma.apiKey.updateMany).toHaveBeenCalledWith({
      where: { userId: "member", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(recheckUserSockets).toHaveBeenCalledWith("member");
    expect(disconnectApiKey).toHaveBeenCalledWith("member-api-key");
  });
});
