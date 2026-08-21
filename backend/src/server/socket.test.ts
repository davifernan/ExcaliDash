import { beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { BOOTSTRAP_USER_ID } from "../auth/authMode";
import { buildShareLinkToken, hashShareLinkToken } from "../authz/sharing";
import { registerSocketHandlers } from "./socket";

type Emission = {
  senderId: string;
  scope: string;
  event: string;
  payload: any;
  volatile: boolean;
};

class FakeOperator {
  constructor(
    private emissions: Emission[],
    private senderId: string,
    private scope: string,
    private isVolatile = false,
  ) {}

  get volatile() {
    return new FakeOperator(this.emissions, this.senderId, this.scope, true);
  }

  emit(event: string, payload: any) {
    this.emissions.push({
      senderId: this.senderId,
      scope: this.scope,
      event,
      payload,
      volatile: this.isVolatile,
    });
  }
}

class FakeSocket {
  readonly handshake = { auth: {}, headers: {} };
  readonly rooms: Set<string>;
  private handlers = new Map<string, (...args: any[]) => any>();

  constructor(
    readonly id: string,
    private emissions: Emission[],
  ) {
    this.rooms = new Set([id]);
  }

  get volatile() {
    return this;
  }

  on(event: string, handler: (...args: any[]) => any) {
    this.handlers.set(event, handler);
  }

  emit(event: string, payload: any) {
    this.emissions.push({
      senderId: "server",
      scope: this.id,
      event,
      payload,
      volatile: false,
    });
  }

  to(scope: string) {
    return new FakeOperator(this.emissions, this.id, scope);
  }

  async join(scope: string) {
    this.rooms.add(scope);
  }

  async leave(scope: string) {
    this.rooms.delete(scope);
  }

  async trigger(event: string, ...args: any[]) {
    return await this.handlers.get(event)?.(...args);
  }
}

class FakeIo {
  readonly emissions: Emission[] = [];
  private middleware: ((socket: FakeSocket, next: (error?: Error) => void) => any) | null = null;
  private connectionHandler: ((socket: FakeSocket) => void) | null = null;

  use(handler: any) {
    this.middleware = handler;
  }

  on(event: string, handler: any) {
    if (event === "connection") this.connectionHandler = handler;
  }

  to(scope: string) {
    return new FakeOperator(this.emissions, "io", scope);
  }

  async connect(id: string, auth: Record<string, unknown> = {}) {
    const socket = new FakeSocket(id, this.emissions);
    Object.assign(socket.handshake.auth, auth);
    await new Promise<void>((resolve, reject) => {
      this.middleware?.(socket, (error?: Error) => (error ? reject(error) : resolve()));
    });
    this.connectionHandler?.(socket);
    return socket;
  }
}

const room = (drawingId: string) => `drawing_${drawingId}`;

describe("socket collaboration security and follow state", () => {
  let io: FakeIo;
  let allowed: boolean;
  let accessLookups: number;

  beforeEach(() => {
    io = new FakeIo();
    allowed = true;
    accessLookups = 0;
    const prisma = {
      drawing: {
        findUnique: async () => {
          accessLookups += 1;
          return allowed ? { userId: BOOTSTRAP_USER_ID } : null;
        },
      },
      drawingLinkShare: { findFirst: async () => null },
    };
    registerSocketHandlers({
      io: io as any,
      prisma: prisma as any,
      authModeService: { getAuthEnabled: async () => false } as any,
      jwtSecret: "test-secret",
    });
  });

  const join = async (socket: FakeSocket, drawingId = "drawing-1", shareToken?: string) => {
    let ack: any;
    await socket.trigger(
      "join-room",
      {
        drawingId,
        shareToken,
        user: {
          id: "spoofed-account",
          socketId: "spoofed-socket",
          name: "Local User",
          color: "#123456",
        },
      },
      (payload: any) => {
        ack = payload;
      },
    );
    return ack;
  };

  const lastEmission = (event: string, scope?: string) =>
    io.emissions.filter((item) => item.event === event && (!scope || item.scope === scope)).at(-1);

  it("keeps two tabs from one account as independent socket presences", async () => {
    const oldTab = await io.connect("socket-old");
    const newTab = await io.connect("socket-new");
    const oldAck = await join(oldTab);
    const newAck = await join(newTab);

    // Which account a presence belongs to is not on the wire any more; that
    // grouping is asserted against the registry in presenceRegistry.test.ts.
    expect(oldAck.presence).toMatchObject({ presenceId: "socket-old" });
    expect(oldAck.presence).not.toHaveProperty("accountId");
    expect(newAck.presence.presenceId).toBe("socket-new");
    expect(lastEmission("presence-update", room("drawing-1"))?.payload).toHaveLength(2);

    await newTab.trigger("disconnect");
    expect(lastEmission("presence-update", room("drawing-1"))?.payload).toEqual([
      expect.objectContaining({ presenceId: "socket-old" }),
    ]);

    await oldTab.trigger("cursor-move", {
      drawingId: "drawing-1",
      pointer: { x: 1, y: 2, tool: "pointer" },
      button: "up",
    });
    expect(lastEmission("cursor-move", room("drawing-1"))?.payload.presenceId).toBe("socket-old");
  });

  it("whitelists cursor and element relay fields", async () => {
    const socket = await io.connect("socket-a");
    await join(socket);
    await socket.trigger("cursor-move", {
      drawingId: "drawing-1",
      pointer: { x: 12, y: 34, tool: "laser", injected: true },
      button: "down",
      userId: "admin",
      color: "#ffffff",
      injected: { secret: true },
    });

    expect(lastEmission("cursor-move")?.payload).toEqual({
      drawingId: "drawing-1",
      presenceId: "socket-a",
      pointer: { x: 12, y: 34, tool: "laser" },
      button: "down",
      username: "Local User",
      color: "#123456",
    });

    await socket.trigger("element-update", {
      drawingId: "drawing-1",
      elements: [{ id: "element-1" }],
      files: { file1: { id: "file1" } },
      elementOrder: ["element-1"],
      userId: "admin",
      injected: true,
    });
    expect(lastEmission("element-update")?.payload).toEqual({
      elements: [{ id: "element-1" }],
      files: { file1: { id: "file1" } },
      elementOrder: ["element-1"],
    });
  });

  it("routes finite viewport bounds only to a registered follower", async () => {
    const target = await io.connect("socket-target");
    const follower = await io.connect("socket-follower");
    const bystander = await io.connect("socket-bystander");
    await join(target);
    await join(follower);
    await join(bystander);
    await follower.trigger("follow-user", {
      drawingId: "drawing-1",
      targetPresenceId: "socket-target",
      action: "FOLLOW",
    });
    io.emissions.length = 0;

    await target.trigger("viewport-bounds", {
      drawingId: "drawing-1",
      sceneBounds: [-100, -50, 500, 350],
      scrollX: 999,
      injected: true,
    });

    expect(io.emissions).toEqual([
      {
        senderId: "io",
        scope: "socket-follower",
        event: "viewport-bounds",
        payload: {
          drawingId: "drawing-1",
          presenceId: "socket-target",
          sceneBounds: [-100, -50, 500, 350],
          sequence: 1,
        },
        volatile: true,
      },
    ]);
    expect(io.emissions.some((item) => item.scope === "socket-bystander")).toBe(false);

    await target.trigger("viewport-bounds", {
      drawingId: "drawing-1",
      sceneBounds: [0, 0, Number.POSITIVE_INFINITY, 100],
    });
    expect(io.emissions).toHaveLength(1);
  });

  it("rejects self-follow and cleans both edge directions on disconnect", async () => {
    const target = await io.connect("socket-target");
    const follower = await io.connect("socket-follower");
    await join(target);
    await join(follower);

    await target.trigger("follow-user", {
      drawingId: "drawing-1",
      targetPresenceId: "socket-target",
      action: "FOLLOW",
    });
    expect(lastEmission("follow-status", "socket-target")?.payload.reason).toBe("self-follow");

    await follower.trigger("follow-user", {
      drawingId: "drawing-1",
      targetPresenceId: "socket-target",
      action: "FOLLOW",
    });
    expect(lastEmission("followed-by-update", "socket-target")?.payload.followers).toEqual([
      { presenceId: "socket-follower", name: "Local User" },
    ]);
    await follower.trigger("disconnect");
    expect(lastEmission("followed-by-update", "socket-target")?.payload.followers).toEqual([]);

    const nextFollower = await io.connect("socket-next-follower");
    await join(nextFollower);
    await nextFollower.trigger("follow-user", {
      drawingId: "drawing-1",
      targetPresenceId: "socket-target",
      action: "FOLLOW",
    });
    await target.trigger("disconnect");
    expect(lastEmission("follow-status", "socket-next-follower")?.payload).toMatchObject({
      followingPresenceId: null,
      reason: "disconnected",
    });
  });

  it("checks fresh read access and removes follow edges after revocation", async () => {
    const target = await io.connect("socket-target");
    const follower = await io.connect("socket-follower");
    await join(target);
    await join(follower);
    await follower.trigger("follow-user", {
      drawingId: "drawing-1",
      targetPresenceId: "socket-target",
      action: "FOLLOW",
    });
    const lookupsBeforeEvent = accessLookups;
    allowed = false;

    await target.trigger("viewport-bounds", {
      drawingId: "drawing-1",
      sceneBounds: [0, 0, 100, 100],
    });

    expect(accessLookups).toBeGreaterThan(lookupsBeforeEvent);
    expect(lastEmission("follow-status", "socket-follower")?.payload.reason).toBe("access-revoked");
    expect(lastEmission("presence-update", room("drawing-1"))?.payload).toEqual([
      expect.objectContaining({ presenceId: "socket-follower" }),
    ]);
    expect(lastEmission("error", "socket-target")?.payload.message).toMatch(/do not have access/);
  });

  it("cleans old-room presence and relationships on a board switch", async () => {
    const target = await io.connect("socket-target");
    const follower = await io.connect("socket-follower");
    await join(target, "drawing-1");
    await join(follower, "drawing-1");
    await follower.trigger("follow-user", {
      drawingId: "drawing-1",
      targetPresenceId: "socket-target",
      action: "FOLLOW",
    });

    await join(target, "drawing-2");
    expect(lastEmission("follow-status", "socket-follower")?.payload.reason).toBe("board-changed");
    expect(lastEmission("presence-update", room("drawing-1"))?.payload).toEqual([
      expect.objectContaining({ presenceId: "socket-follower" }),
    ]);
    expect(lastEmission("presence-update", room("drawing-2"))?.payload).toEqual([
      expect.objectContaining({ presenceId: "socket-target" }),
    ]);
  });
});

describe("socket share-link secrets", () => {
  const join = async (socket: FakeSocket, shareToken?: string) => {
    let ack: any;
    await socket.trigger(
      "join-room",
      { drawingId: "drawing-1", shareToken, user: { name: "Link Guest" } },
      (payload: any) => {
        ack = payload;
      },
    );
    return ack;
  };

  it("tells the room who is there without telling it which account that is", async () => {
    // Everyone in the room gets presence-update, and a share link means that
    // room contains people with no account at all. The name is the point of
    // showing presence; the account id is a handle to a real row and stays on
    // the server, where the member list matches it with a scoped subject key.
    const io = new FakeIo();
    const token = buildShareLinkToken();
    const prisma = {
      drawing: { findUnique: async () => ({ userId: "owner-account-id" }) },
      drawingLinkShare: {
        findFirst: async () => ({ permission: "view", tokenHash: hashShareLinkToken(token) }),
      },
      user: {
        findUnique: async () => ({ id: "owner-account-id", isActive: true, name: "Owner Real" }),
      },
      collection: { findFirst: async () => null, findMany: async () => [] },
      collectionShare: { findFirst: async () => null, findMany: async () => [] },
      drawingPermission: { findUnique: async () => null, findMany: async () => [] },
    };
    registerSocketHandlers({
      io: io as any,
      prisma: prisma as any,
      authModeService: { getAuthEnabled: async () => true } as any,
      jwtSecret: "test-secret",
    });

    const ownerToken = jwt.sign(
      { userId: "owner-account-id", email: "owner@example.test", type: "access" },
      "test-secret",
    );
    const owner = await io.connect("socket-owner", { token: ownerToken });
    let ownerAck: any;
    await owner.trigger(
      "join-room",
      // The client claims a name of its own. The server has an account row and
      // uses that instead, which is the whole point of asking the server.
      { drawingId: "drawing-1", user: { id: "made-up", name: "Owner Claimed" } },
      (p: any) => {
        ownerAck = p;
      },
    );
    expect(ownerAck?.ok).toBe(true);

    await join(await io.connect("socket-guest"), token);

    const broadcast = io.emissions.filter((e) => e.event === "presence-update").at(-1);
    expect(broadcast?.payload).toHaveLength(2);
    expect(JSON.stringify(broadcast?.payload)).not.toContain("owner-account-id");
    for (const entry of broadcast!.payload) expect(entry).not.toHaveProperty("accountId");
    // Still useful: the owner is named and marked as the owner.
    expect(broadcast?.payload).toContainEqual(
      expect.objectContaining({ presenceId: "socket-owner", name: "Owner Real", kind: "owner" }),
    );
    expect(JSON.stringify(broadcast?.payload)).not.toContain("Owner Claimed");
    expect(JSON.stringify(broadcast?.payload)).not.toContain("made-up");
    // The joiner's own acknowledgement carries the same shape.
    expect(ownerAck.presence).not.toHaveProperty("accountId");
  });

  it("presents a signed-in account with link-only access as a guest", async () => {
    const io = new FakeIo();
    const token = buildShareLinkToken();
    const prisma = {
      drawing: {
        findUnique: async () => ({ userId: "owner-account-id", collectionId: null }),
        findMany: async () => [{ id: "drawing-1", userId: "owner-account-id", collectionId: null }],
      },
      drawingLinkShare: {
        findFirst: async () => ({ permission: "view", tokenHash: hashShareLinkToken(token) }),
      },
      user: {
        findUnique: async () => ({ id: "link-account-id", isActive: true, name: "Account Name" }),
      },
      collection: { findFirst: async () => null, findMany: async () => [] },
      collectionShare: { findFirst: async () => null, findMany: async () => [] },
      drawingPermission: { findUnique: async () => null, findMany: async () => [] },
    };
    registerSocketHandlers({
      io: io as any,
      prisma: prisma as any,
      authModeService: { getAuthEnabled: async () => true } as any,
      jwtSecret: "test-secret",
    });
    const accountToken = jwt.sign(
      { userId: "link-account-id", email: "link@example.test", type: "access" },
      "test-secret",
    );
    const socket = await io.connect("socket-link-account", { token: accountToken });

    const ack = await join(socket, token);

    expect(ack).toMatchObject({ ok: true, presence: { kind: "guest" } });
    expect(ack.presence.name).not.toBe("Account Name");
  });

  it("rejects missing, wrong, and rotated tokens while accepting only the current token", async () => {
    const io = new FakeIo();
    const firstToken = buildShareLinkToken();
    const secondToken = buildShareLinkToken();
    let currentHash = hashShareLinkToken(firstToken);
    const prisma = {
      drawingLinkShare: {
        findFirst: async () => ({ permission: "view", tokenHash: currentHash }),
      },
    };
    registerSocketHandlers({
      io: io as any,
      prisma: prisma as any,
      authModeService: { getAuthEnabled: async () => true } as any,
      jwtSecret: "test-secret",
    });

    expect((await join(await io.connect("missing")))?.error?.code).toBe("access-denied");
    expect((await join(await io.connect("wrong"), "x".repeat(32)))?.error?.code).toBe(
      "access-denied",
    );
    expect((await join(await io.connect("first"), firstToken))?.ok).toBe(true);

    currentHash = hashShareLinkToken(secondToken);
    expect((await join(await io.connect("rotated"), firstToken))?.error?.code).toBe(
      "access-denied",
    );
    expect((await join(await io.connect("current"), secondToken))?.ok).toBe(true);
  });
});

describe("socket activity rate limiting", () => {
  it("shares one activity budget across one account's simultaneous sockets", async () => {
    const io = new FakeIo();
    const prisma = {
      drawing: {
        findUnique: vi.fn().mockResolvedValue({ userId: "account-1", collectionId: null }),
      },
      drawingLinkShare: { findFirst: vi.fn().mockResolvedValue(null) },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "account-1",
          isActive: true,
          name: "Account One",
        }),
      },
    };
    registerSocketHandlers({
      io: io as any,
      prisma: prisma as any,
      authModeService: { getAuthEnabled: async () => true } as any,
      jwtSecret: "test-secret",
    });
    const token = jwt.sign(
      { userId: "account-1", email: "one@example.test", type: "access" },
      "test-secret",
    );
    const first = await io.connect("socket-first", { token });
    const second = await io.connect("socket-second", { token });
    for (const socket of [first, second]) {
      await socket.trigger("join-room", { drawingId: "drawing-1", user: {} });
    }
    io.emissions.length = 0;

    for (let index = 0; index < 11; index += 1) {
      await first.trigger("user-activity", { drawingId: "drawing-1", isActive: true });
      await second.trigger("user-activity", { drawingId: "drawing-1", isActive: true });
    }

    expect(io.emissions.filter((item) => item.event === "presence-update")).toHaveLength(20);
  });
});
