import express from "express";
import { describe, expect, it, vi } from "vitest";
import { generateApiKey, serializeApiKeyScopes } from "../auth/apiKeys";
import { registerAccountApiKeyRoutes } from "../auth/accountApiKeyRoutes";
import { registerAdminUserRoutes } from "../auth/adminUserRoutes";
import { registerSocketHandlers } from "./socket";

type Emission = { scope: string; event: string; payload: any };

class FakeOperator {
  constructor(
    private emissions: Emission[],
    private scope: string,
  ) {}
  get volatile() {
    return this;
  }
  emit(event: string, payload: any) {
    this.emissions.push({ scope: this.scope, event, payload });
  }
}

class FakeSocket {
  readonly rooms = new Set<string>([this.id]);
  readonly handshake: { auth: { token?: string }; headers: Record<string, string> };
  readonly disconnect = vi.fn(() => {
    this.disconnected = true;
  });
  disconnected = false;
  private handlers = new Map<string, (...args: any[]) => any>();
  constructor(
    readonly id: string,
    private emissions: Emission[],
    token?: string,
  ) {
    this.handshake = { auth: token ? { token } : {}, headers: {} };
  }
  get volatile() {
    return this;
  }
  on(event: string, handler: (...args: any[]) => any) {
    this.handlers.set(event, handler);
  }
  emit(event: string, payload: any) {
    this.emissions.push({ scope: this.id, event, payload });
  }
  to(scope: string) {
    return new FakeOperator(this.emissions, scope);
  }
  async join(scope: string) {
    this.rooms.add(scope);
  }
  async leave(scope: string) {
    this.rooms.delete(scope);
  }
  async trigger(event: string, ...args: any[]) {
    return this.handlers.get(event)?.(...args);
  }
}

class FakeIo {
  readonly emissions: Emission[] = [];
  private middleware: any;
  private connectionHandler: any;
  use(handler: any) {
    this.middleware = handler;
  }
  on(event: string, handler: any) {
    if (event === "connection") this.connectionHandler = handler;
  }
  to(scope: string) {
    return new FakeOperator(this.emissions, scope);
  }
  async connect(id: string, token?: string) {
    const socket = new FakeSocket(id, this.emissions, token);
    await new Promise<void>((resolve, reject) => {
      this.middleware(socket, (error?: Error) => (error ? reject(error) : resolve()));
    });
    await this.connectionHandler(socket);
    return socket;
  }
}

describe("socket API key authorization", () => {
  it("accepts an MCP-style handshake token but denies writes without drawings:write", async () => {
    const generated = generateApiKey();
    const io = new FakeIo();
    const prisma = {
      apiKey: {
        findUnique: vi.fn().mockResolvedValue({
          id: "read-key",
          keyId: generated.keyId,
          tokenHash: generated.tokenHash,
          scopes: serializeApiKeyScopes(["drawings:read"]),
          revokedAt: null,
          user: { id: "key-owner", isActive: true },
        }),
        findFirst: vi.fn().mockResolvedValue({ id: "read-key", revokedAt: null }),
        update: vi.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ name: "MCP", isActive: true }),
      },
      drawing: { findUnique: vi.fn().mockResolvedValue({ userId: "key-owner" }) },
      drawingLinkShare: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    registerSocketHandlers({
      io: io as any,
      prisma: prisma as any,
      authModeService: { getAuthEnabled: async () => true } as any,
      jwtSecret: "test-secret",
    });

    const mcp = await io.connect("mcp-socket", generated.token);
    let joinAck: any;
    await mcp.trigger(
      "join-room",
      { drawingId: "drawing-1", user: { name: "spoofed" } },
      (value: any) => {
        joinAck = value;
      },
    );
    expect(joinAck).toMatchObject({
      ok: true,
      // The account behind the key is not on the wire; see socket.test.ts.
      presence: { presenceId: "mcp-socket", name: "MCP" },
    });

    io.emissions.length = 0;
    await mcp.trigger("element-update", {
      drawingId: "drawing-1",
      elements: [{ id: "forbidden" }],
    });
    expect(io.emissions).toContainEqual({
      scope: "mcp-socket",
      event: "error",
      payload: { message: "Read-only access: cannot edit this drawing" },
    });
    expect(io.emissions.some((item) => item.event === "element-update")).toBe(false);

    const router = express.Router();
    registerAccountApiKeyRoutes({
      router,
      prisma,
      requireAuth: ((req: any, _res: any, next: any) => {
        req.user = { id: "key-owner" };
        next();
      }) as any,
      accountActionRateLimiter: ((_req: any, _res: any, next: any) => next()) as any,
      ensureAuthEnabled: async () => true,
      requireCsrf: () => true,
      sanitizeText: (value: unknown) => String(value),
      config: { enableAuditLogging: false },
    } as any);
    const layer = (router as any).stack.find(
      (candidate: any) =>
        candidate.route?.path === "/api-keys/:id" && candidate.route.methods.delete,
    );
    const req: any = { params: { id: "read-key" }, headers: {}, connection: {} };
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
    expect(mcp.rooms.has("drawing_drawing-1")).toBe(false);
    expect(mcp.disconnect).toHaveBeenCalledWith(true);
  });

  it("disconnects only sockets authenticated by the revoked key id", async () => {
    const first = generateApiKey();
    const second = generateApiKey();
    const rows = new Map([
      [first.keyId, { id: "key-a", generated: first }],
      [second.keyId, { id: "key-b", generated: second }],
    ]);
    const io = new FakeIo();
    const prisma = {
      apiKey: {
        findUnique: vi.fn(async ({ where }: any) => {
          if (where.id) {
            const current = Array.from(rows.values()).find(
              (candidate) => candidate.id === where.id,
            );
            return current ? { id: current.id, revokedAt: null, userId: "owner" } : null;
          }
          const entry = rows.get(where.keyId)!;
          return {
            id: entry.id,
            keyId: entry.generated.keyId,
            tokenHash: entry.generated.tokenHash,
            scopes: serializeApiKeyScopes(),
            revokedAt: null,
            user: { id: "owner", isActive: true },
          };
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ name: "Agent", isActive: true }),
      },
      drawing: { findUnique: vi.fn().mockResolvedValue({ userId: "owner" }) },
      drawingLinkShare: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    registerSocketHandlers({
      io: io as any,
      prisma: prisma as any,
      authModeService: { getAuthEnabled: async () => true } as any,
      jwtSecret: "test-secret",
    });
    const revoked = await io.connect("revoked", first.token);
    const retained = await io.connect("retained", second.token);
    await Promise.all([
      revoked.trigger("join-room", { drawingId: "drawing-1", user: {} }),
      retained.trigger("join-room", { drawingId: "drawing-1", user: {} }),
    ]);
    io.emissions.length = 0;
    await retained.trigger("element-update", {
      drawingId: "drawing-1",
      elements: [{ id: "allowed" }],
    });
    expect(io.emissions).toContainEqual({
      scope: "drawing_drawing-1",
      event: "element-update",
      payload: {
        elements: [{ id: "allowed" }],
        files: undefined,
        elementOrder: undefined,
      },
    });

    const router = express.Router();
    registerAdminUserRoutes({
      router,
      prisma,
      requireAuth: ((req: any, _res: any, next: any) => {
        req.user = { id: "admin", role: "ADMIN" };
        next();
      }) as any,
      accountActionRateLimiter: ((_req: any, _res: any, next: any) => next()) as any,
      ensureAuthEnabled: async () => true,
      requireCsrf: () => true,
      requireAdmin: () => true,
      config: { enableAuditLogging: false },
    } as any);
    const layer = (router as any).stack.find(
      (candidate: any) =>
        candidate.route?.path === "/users/api-keys/:id" && candidate.route.methods.delete,
    );
    const req: any = { params: { id: "key-a" }, headers: {}, connection: {} };
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
    expect(revoked.disconnect).toHaveBeenCalledOnce();
    expect(retained.disconnect).not.toHaveBeenCalled();
    expect(retained.rooms.has("drawing_drawing-1")).toBe(true);
  });

  it("cannot let a handshake finish after its API key was revoked", async () => {
    const generated = generateApiKey();
    let revokedAt: Date | null = null;
    let lastUsedStarted = false;
    let releaseLastUsed: (() => void) | undefined;
    const prisma = {
      apiKey: {
        findUnique: vi.fn(async ({ where }: any) => {
          if (where.keyId === generated.keyId) {
            return {
              id: "racing-key",
              keyId: generated.keyId,
              tokenHash: generated.tokenHash,
              scopes: serializeApiKeyScopes(),
              revokedAt,
              user: { id: "owner", isActive: true },
            };
          }
          if (where.id === "racing-key") {
            return { id: "racing-key", revokedAt };
          }
          return null;
        }),
        findFirst: vi.fn().mockImplementation(async () => ({
          id: "racing-key",
          revokedAt,
        })),
        update: vi.fn(async ({ data }: any) => {
          if (data.lastUsedAt) {
            lastUsedStarted = true;
            await new Promise<void>((resolve) => {
              releaseLastUsed = resolve;
            });
          }
          if (data.revokedAt) revokedAt = data.revokedAt;
          return {};
        }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ name: "Agent", isActive: true }),
      },
      drawing: { findUnique: vi.fn().mockResolvedValue({ userId: "owner" }) },
      drawingLinkShare: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const io = new FakeIo();
    registerSocketHandlers({
      io: io as any,
      prisma: prisma as any,
      authModeService: { getAuthEnabled: async () => true } as any,
      jwtSecret: "test-secret",
    });

    const pendingSocket = io.connect("racing-socket", generated.token);
    await vi.waitFor(() => expect(lastUsedStarted).toBe(true));

    const router = express.Router();
    registerAccountApiKeyRoutes({
      router,
      prisma,
      requireAuth: ((req: any, _res: any, next: any) => {
        req.user = { id: "owner" };
        next();
      }) as any,
      accountActionRateLimiter: ((_req: any, _res: any, next: any) => next()) as any,
      ensureAuthEnabled: async () => true,
      requireCsrf: () => true,
      sanitizeText: (value: unknown) => String(value),
      config: { enableAuditLogging: false },
    } as any);
    const layer = (router as any).stack.find(
      (candidate: any) =>
        candidate.route?.path === "/api-keys/:id" && candidate.route.methods.delete,
    );
    const req: any = {
      params: { id: "racing-key" },
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

    releaseLastUsed?.();
    const socket = await pendingSocket;
    await vi.waitFor(() => expect(socket.disconnect).toHaveBeenCalledWith(true));
    expect(socket.disconnected).toBe(true);

    let joinAck: any;
    await socket.trigger("join-room", { drawingId: "drawing-1", user: {} }, (value: any) => {
      joinAck = value;
    });
    expect(joinAck).toMatchObject({
      ok: false,
      error: { code: "authentication-failed" },
    });
  });
});
