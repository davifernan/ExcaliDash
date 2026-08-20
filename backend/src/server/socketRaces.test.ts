import { beforeEach, describe, expect, it } from "vitest";
import { BOOTSTRAP_USER_ID } from "../auth/authMode";
import type { CollaborationAccessController } from "./collaborationAccess";
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
  readonly handshake = { auth: {}, headers: {} };
  readonly rooms = new Set<string>([this.id]);
  private handlers = new Map<string, (...args: any[]) => any>();
  readonly disconnect = vi.fn();
  constructor(
    readonly id: string,
    private emissions: Emission[],
  ) {}
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
  private middleware: ((socket: FakeSocket, next: (error?: Error) => void) => any) | null = null;
  private connectionHandler: ((socket: FakeSocket) => void) | null = null;
  use(handler: any) {
    this.middleware = handler;
  }
  on(event: string, handler: any) {
    if (event === "connection") this.connectionHandler = handler;
  }
  to(scope: string) {
    return new FakeOperator(this.emissions, scope);
  }
  async connect(id: string) {
    const socket = new FakeSocket(id, this.emissions);
    await new Promise<void>((resolve, reject) => {
      this.middleware?.(socket, (error?: Error) =>
        error ? reject(error) : resolve(),
      );
    });
    this.connectionHandler?.(socket);
    return socket;
  }
}

const room = (drawingId: string) => `drawing_${drawingId}`;

describe("socket collaboration races", () => {
  let io: FakeIo;
  let allowed: boolean;
  let accessLookups: number;
  let controller: CollaborationAccessController;
  let drawingLookup: () => Promise<{ userId: string } | null>;

  beforeEach(() => {
    io = new FakeIo();
    allowed = true;
    accessLookups = 0;
    drawingLookup = async () =>
      allowed ? { userId: BOOTSTRAP_USER_ID } : null;
    controller = registerSocketHandlers({
      io: io as any,
      prisma: {
        drawing: {
          findUnique: async () => {
            accessLookups += 1;
            return drawingLookup();
          },
        },
        drawingLinkShare: { findFirst: async () => null },
      } as any,
      authModeService: { getAuthEnabled: async () => false } as any,
      jwtSecret: "test-secret",
    });
  });

  const join = (socket: FakeSocket, drawingId = "drawing-1") =>
    socket.trigger("join-room", {
      drawingId,
      user: { name: "Local User", color: "#123456" },
    });
  const lastEmission = (event: string, scope?: string) =>
    io.emissions
      .filter((item) => item.event === event && (!scope || item.scope === scope))
      .at(-1);

  it("evicts passive sockets and their follow edges immediately after a revoke", async () => {
    const target = await io.connect("socket-target");
    const viewer = await io.connect("socket-revoked");
    await join(target);
    await join(viewer);
    await viewer.trigger("follow-user", {
      drawingId: "drawing-1",
      targetPresenceId: "socket-target",
      action: "FOLLOW",
    });
    allowed = false;

    await controller.recheckDrawingAccess("drawing-1");

    expect(target.rooms.has(room("drawing-1"))).toBe(false);
    expect(viewer.rooms.has(room("drawing-1"))).toBe(false);
    expect(lastEmission("follow-status", "socket-revoked")?.payload).toMatchObject({
      followingPresenceId: null,
      reason: "access-revoked",
    });
    expect(lastEmission("presence-update", room("drawing-1"))?.payload).toEqual([]);
  });

  it("does not create ghost presence when disconnect overtakes an awaited join", async () => {
    let release: ((value: { userId: string }) => void) | null = null;
    drawingLookup = () => new Promise((resolve) => { release = resolve; });
    const stale = await io.connect("socket-stale");
    const pendingJoin = join(stale);
    await Promise.resolve();
    await stale.trigger("disconnect");
    release?.({ userId: BOOTSTRAP_USER_ID });
    await pendingJoin;

    drawingLookup = async () => ({ userId: BOOTSTRAP_USER_ID });
    const observer = await io.connect("socket-observer");
    await join(observer);
    expect(stale.rooms.has(room("drawing-1"))).toBe(false);
    expect(lastEmission("presence-update", room("drawing-1"))?.payload).toEqual([
      expect.objectContaining({ presenceId: "socket-observer" }),
    ]);
  });

  it("serializes concurrent joins so only the newest board owns the socket", async () => {
    let release: ((value: { userId: string }) => void) | null = null;
    let lookupNumber = 0;
    drawingLookup = async () => {
      lookupNumber += 1;
      return lookupNumber === 1
        ? new Promise((resolve) => { release = resolve; })
        : { userId: BOOTSTRAP_USER_ID };
    };
    const socket = await io.connect("socket-switching");
    const firstJoin = join(socket, "drawing-1");
    await Promise.resolve();
    const secondJoin = join(socket, "drawing-2");
    while (!release) await Promise.resolve();
    release?.({ userId: BOOTSTRAP_USER_ID });
    await Promise.all([firstJoin, secondJoin]);

    expect(socket.rooms.has(room("drawing-1"))).toBe(false);
    expect(socket.rooms.has(room("drawing-2"))).toBe(true);
  });

  it("cancels an awaited join when leave-room overtakes it", async () => {
    let release: ((value: { userId: string }) => void) | null = null;
    drawingLookup = () => new Promise((resolve) => { release = resolve; });
    const socket = await io.connect("socket-leaving");
    const pendingJoin = join(socket);
    await Promise.resolve();

    await socket.trigger("leave-room", { drawingId: "drawing-1" });
    release?.({ userId: BOOTSTRAP_USER_ID });
    await pendingJoin;

    expect(socket.rooms.has(room("drawing-1"))).toBe(false);
    expect(lastEmission("presence-update", room("drawing-1"))).toBeUndefined();
  });

  it("bounds a flooded join queue while the database is blocked", async () => {
    let release: ((value: { userId: string }) => void) | null = null;
    drawingLookup = () => new Promise((resolve) => { release = resolve; });
    const socket = await io.connect("socket-flood");
    const acknowledgements: any[] = [];
    const requests = Array.from({ length: 40 }, (_, index) =>
      socket.trigger(
        "join-room",
        { drawingId: `drawing-${index}`, user: { name: "Flood" } },
        (value: any) => acknowledgements.push(value),
      ),
    );
    await vi.waitFor(() => expect(accessLookups).toBe(1));
    expect(
      acknowledgements.filter((value) => value?.error?.code === "queue-full"),
    ).toHaveLength(2);
    expect(
      acknowledgements.filter((value) => value?.error?.code === "rate-limited"),
    ).toHaveLength(30);

    release?.({ userId: BOOTSTRAP_USER_ID });
    drawingLookup = async () => ({ userId: BOOTSTRAP_USER_ID });
    await Promise.all(requests);
    expect(accessLookups).toBeGreaterThan(0);
    expect(accessLookups).toBeLessThanOrEqual(8);
  });

  it("lets UNFOLLOW preempt a slow FOLLOW and cancel its eventual edge", async () => {
    const target = await io.connect("socket-target");
    const follower = await io.connect("socket-follower");
    await join(target);
    await join(follower);
    const blockAt = accessLookups + 2;
    let release: (() => void) | null = null;
    const normalLookup = drawingLookup;
    drawingLookup = async () => {
      if (accessLookups === blockAt) {
        await new Promise<void>((resolve) => { release = resolve; });
      }
      return normalLookup();
    };
    const follow = follower.trigger("follow-user", {
      drawingId: "drawing-1",
      targetPresenceId: "socket-target",
      action: "FOLLOW",
    });
    while (!release) await Promise.resolve();
    let unfollowAck: any;
    await follower.trigger(
      "follow-user",
      { drawingId: "drawing-1", action: "UNFOLLOW" },
      (value: any) => { unfollowAck = value; },
    );

    expect(unfollowAck).toEqual({ ok: true });
    expect(lastEmission("follow-status", "socket-follower")?.payload)
      .toMatchObject({ followingPresenceId: null });
    expect(lastEmission("followed-by-update", "socket-target")).toBeUndefined();

    release();
    await follow;
    expect(lastEmission("followed-by-update", "socket-target")).toBeUndefined();
  });

  it("bounds a flooded follow queue while its first access lookup is blocked", async () => {
    const target = await io.connect("flood-target");
    const follower = await io.connect("flood-follower");
    await join(target);
    await join(follower);
    let release: (() => void) | null = null;
    const normalLookup = drawingLookup;
    drawingLookup = async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return normalLookup();
    };

    const commands = Array.from({ length: 30 }, () =>
      follower.trigger("follow-user", {
        drawingId: "drawing-1",
        targetPresenceId: "flood-target",
        action: "FOLLOW",
      }),
    );
    await Promise.resolve();

    expect(
      io.emissions.filter(
        (item) => item.event === "follow-status" && item.payload.reason === "queue-full",
      ),
    ).toHaveLength(4);
    expect(
      io.emissions.filter(
        (item) => item.event === "follow-status" && item.payload.reason === "rate-limited",
      ),
    ).toHaveLength(18);

    drawingLookup = normalLookup;
    release?.();
    await Promise.all(commands);
    expect(lastEmission("followed-by-update", "flood-target")?.payload.followers)
      .toEqual([{ presenceId: "flood-follower", name: "Local User" }]);
  });

  it("rejects a three-person follow cycle without changing existing edges", async () => {
    const sockets = await Promise.all([
      io.connect("alice"), io.connect("bob"), io.connect("carol"),
    ]);
    await Promise.all(sockets.map((socket) => join(socket)));
    await sockets[0].trigger("follow-user", {
      drawingId: "drawing-1", targetPresenceId: "bob", action: "FOLLOW",
    });
    await sockets[1].trigger("follow-user", {
      drawingId: "drawing-1", targetPresenceId: "carol", action: "FOLLOW",
    });
    await sockets[2].trigger("follow-user", {
      drawingId: "drawing-1", targetPresenceId: "alice", action: "FOLLOW",
    });

    expect(lastEmission("follow-status", "carol")?.payload).toEqual({
      drawingId: "drawing-1",
      followingPresenceId: null,
      reason: "cycle-detected",
    });
    expect(lastEmission("followed-by-update", "alice")).toBeUndefined();
  });

  it("always permits UNFOLLOW after the FOLLOW rate limit is exhausted", async () => {
    const target = await io.connect("target");
    const follower = await io.connect("follower");
    await join(target);
    await join(follower);
    for (let index = 0; index < 12; index += 1) {
      await follower.trigger("follow-user", {
        drawingId: "drawing-1", targetPresenceId: "target", action: "FOLLOW",
      });
    }
    await follower.trigger("follow-user", {
      drawingId: "drawing-1", action: "UNFOLLOW",
    });

    expect(lastEmission("follow-status", "follower")?.payload).toEqual({
      drawingId: "drawing-1",
      followingPresenceId: null,
    });
    expect(lastEmission("followed-by-update", "target")?.payload.followers)
      .toEqual([]);
  });

  it("delivers no cached viewport after an explicit access revocation", async () => {
    const target = await io.connect("cache-target");
    const follower = await io.connect("cache-follower");
    await join(target);
    await join(follower);
    await follower.trigger("follow-user", {
      drawingId: "drawing-1", targetPresenceId: "cache-target", action: "FOLLOW",
    });
    await target.trigger("viewport-bounds", {
      drawingId: "drawing-1", sceneBounds: [0, 0, 100, 100],
    });
    const deliveredBeforeRevoke = io.emissions.filter(
      (item) => item.event === "viewport-bounds" && item.scope === "cache-follower",
    );
    expect(deliveredBeforeRevoke).toHaveLength(1);

    allowed = false;
    await controller.recheckDrawingAccess("drawing-1");
    await target.trigger("viewport-bounds", {
      drawingId: "drawing-1", sceneBounds: [20, 20, 120, 120],
    });
    expect(
      io.emissions.filter(
        (item) => item.event === "viewport-bounds" && item.scope === "cache-follower",
      ),
    ).toHaveLength(1);
    expect(follower.rooms.has(room("drawing-1"))).toBe(false);
  });

});
