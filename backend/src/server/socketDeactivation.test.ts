import express from "express";
import jwt from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";
import { registerAdminUserRoutes } from "../auth/adminUserRoutes";
import { registerSocketHandlers } from "./socket";

type ReceivedEvent = { event: string; payload: any };

class FakeOperator {
  constructor(
    private sockets: Map<string, FakeSocket>,
    private scope: string,
    private excludedId?: string,
  ) {}
  get volatile() {
    return this;
  }
  emit(event: string, payload: any) {
    for (const socket of this.sockets.values()) {
      if (socket.id !== this.excludedId && socket.rooms.has(this.scope)) {
        socket.received.push({ event, payload });
      }
    }
  }
}

class FakeSocket {
  readonly rooms = new Set<string>([this.id]);
  readonly received: ReceivedEvent[] = [];
  readonly handshake: {
    auth: { token: string };
    headers: Record<string, string>;
  };
  readonly disconnect = vi.fn(() => {
    this.disconnected = true;
    this.rooms.clear();
  });
  disconnected = false;
  private handlers = new Map<string, (...args: any[]) => any>();

  constructor(
    readonly id: string,
    token: string,
    private sockets: Map<string, FakeSocket>,
  ) {
    this.handshake = { auth: { token }, headers: {} };
  }
  get volatile() {
    return this;
  }
  on(event: string, handler: (...args: any[]) => any) {
    this.handlers.set(event, handler);
  }
  emit(event: string, payload: any) {
    this.received.push({ event, payload });
  }
  to(scope: string) {
    return new FakeOperator(this.sockets, scope, this.id);
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
  readonly sockets = new Map<string, FakeSocket>();
  private middleware: any;
  private connectionHandler: any;
  use(handler: any) {
    this.middleware = handler;
  }
  on(event: string, handler: any) {
    if (event === "connection") this.connectionHandler = handler;
  }
  to(scope: string) {
    return new FakeOperator(this.sockets, scope);
  }
  async connect(id: string, token: string) {
    const socket = new FakeSocket(id, token, this.sockets);
    this.sockets.set(id, socket);
    await new Promise<void>((resolve, reject) => {
      this.middleware(socket, (error?: Error) => (error ? reject(error) : resolve()));
    });
    await this.connectionHandler(socket);
    return socket;
  }
}

const tokenFor = (userId: string) =>
  jwt.sign({ userId, email: `${userId}@example.test`, type: "access" }, "test-secret");

describe("live account deactivation", () => {
  it("removes and disconnects an existing editor before the admin response", async () => {
    const active = new Map([
      ["owner", true],
      ["member", true],
      ["admin", true],
    ]);
    const prisma = {
      user: {
        findUnique: vi.fn(async ({ where }: any) => {
          const isActive = active.get(where.id);
          if (typeof isActive !== "boolean") return null;
          return {
            id: where.id,
            name: where.id,
            email: `${where.id}@example.test`,
            username: where.id,
            role: where.id === "admin" ? "ADMIN" : "USER",
            mustResetPassword: false,
            isActive,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          };
        }),
        update: vi.fn(async ({ where, data }: any) => {
          if (typeof data.isActive === "boolean") active.set(where.id, data.isActive);
          return {
            id: where.id,
            name: where.id,
            email: `${where.id}@example.test`,
            username: where.id,
            role: "USER",
            mustResetPassword: false,
            isActive: active.get(where.id),
            createdAt: new Date(0),
            updatedAt: new Date(0),
          };
        }),
      },
      drawing: {
        findUnique: vi.fn().mockResolvedValue({ userId: "owner" }),
      },
      drawingPermission: {
        findUnique: vi.fn(async ({ where }: any) =>
          where.drawingId_granteeUserId.granteeUserId === "member" ? { permission: "edit" } : null,
        ),
      },
      drawingLinkShare: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const io = new FakeIo();
    registerSocketHandlers({
      io: io as any,
      prisma: prisma as any,
      authModeService: { getAuthEnabled: async () => true } as any,
      jwtSecret: "test-secret",
    });
    const owner = await io.connect("owner-socket", tokenFor("owner"));
    const member = await io.connect("member-socket", tokenFor("member"));
    await owner.trigger("join-room", { drawingId: "drawing-1", user: {} });
    await member.trigger("join-room", { drawingId: "drawing-1", user: {} });
    owner.received.length = 0;
    member.received.length = 0;

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
      countActiveAdmins: async () => 1,
      sanitizeText: (value: unknown) => String(value),
      config: { enableAuditLogging: false },
    } as any);
    const layer = (router as any).stack.find(
      (candidate: any) => candidate.route?.path === "/users/:id" && candidate.route.methods.patch,
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
    expect(member.disconnect).toHaveBeenCalledWith(true);
    expect(member.rooms.has("drawing_drawing-1")).toBe(false);
    member.received.length = 0;

    await owner.trigger("element-update", {
      drawingId: "drawing-1",
      elements: [{ id: "after-deactivation" }],
    });
    expect(member.received).toEqual([]);
  });
});
