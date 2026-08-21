import { beforeEach, describe, expect, it } from "vitest";
import { BOOTSTRAP_USER_ID } from "../auth/authMode";
import { buildShareLinkToken, hashShareLinkToken } from "../authz/sharing";
import { registerSocketHandlers } from "./socket";
import { FakeIo, type FakeSocket, room } from "../__tests__/socketTestDoubles";

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

    expect(oldAck.presence).toMatchObject({
      presenceId: "socket-old",
      accountId: BOOTSTRAP_USER_ID,
    });
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
