import type { Server, Socket } from "socket.io";
import type { PrismaClient } from "../generated/client";
import { BOOTSTRAP_USER_ID, type AuthModeService } from "../auth/authMode";
import {
  canEditDrawing,
  canViewDrawing,
  getDrawingAccess,
  type DrawingPrincipal,
} from "../authz/sharing";
import { createSocketAuthenticator } from "./socketAuth";
import {
  createRateLimiter,
  parseCursorPayload,
  parseDrawingId,
  parseElementUpdatePayload,
  parseSceneBounds,
  type PresenceUser,
} from "./socketProtocol";

type RegisterSocketHandlersDeps = {
  io: Server;
  prisma: PrismaClient;
  authModeService: AuthModeService;
  jwtSecret: string;
};

const roomName = (drawingId: string) => `drawing_${drawingId}`;

const toPresenceName = (value: unknown): string => {
  if (typeof value !== "string") return "User";
  const trimmed = value.trim().slice(0, 120);
  return trimmed || "User";
};

const toPresenceInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase() || "U";
};

const toPresenceColor = (value: unknown): string => {
  if (typeof value !== "string") return "#4f46e5";
  return /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : "#4f46e5";
};

export const registerSocketHandlers = ({
  io,
  prisma,
  authModeService,
  jwtSecret,
}: RegisterSocketHandlersDeps) => {
  const principals = new Map<string, DrawingPrincipal>();
  const connectedSockets = new Map<string, Socket>();
  const drawingBySocket = new Map<string, string>();
  const presencesByDrawing = new Map<string, Map<string, PresenceUser>>();
  const followingBySocket = new Map<string, string>();
  const followersBySocket = new Map<string, Set<string>>();
  const viewportSequenceBySocket = new Map<string, number>();

  io.use(
    createSocketAuthenticator({ prisma, authModeService, jwtSecret, principals }),
  );

  const emitPresence = (drawingId: string) => {
    const users = Array.from(presencesByDrawing.get(drawingId)?.values() || []);
    io.to(roomName(drawingId)).emit("presence-update", users);
  };

  const getPresence = (socketId: string): PresenceUser | null => {
    const drawingId = drawingBySocket.get(socketId);
    return drawingId
      ? presencesByDrawing.get(drawingId)?.get(socketId) || null
      : null;
  };

  const emitFollowedBy = (targetId: string) => {
    const drawingId = drawingBySocket.get(targetId);
    if (!drawingId) return;
    const followers = Array.from(followersBySocket.get(targetId) || [])
      .filter((id) => drawingBySocket.get(id) === drawingId)
      .map(getPresence)
      .filter((user): user is PresenceUser => Boolean(user))
      .map((user) => ({ presenceId: user.presenceId, name: user.name }));
    io.to(targetId).emit("followed-by-update", { drawingId, followers });
  };

  const clearFollower = (
    followerId: string,
    reason: string,
    notifyFollower: boolean,
  ) => {
    const targetId = followingBySocket.get(followerId);
    if (!targetId) return;
    followingBySocket.delete(followerId);
    const followers = followersBySocket.get(targetId);
    followers?.delete(followerId);
    if (followers?.size === 0) followersBySocket.delete(targetId);
    emitFollowedBy(targetId);
    if (notifyFollower) {
      const drawingId = drawingBySocket.get(followerId);
      if (drawingId) {
        io.to(followerId).emit("follow-status", {
          drawingId,
          followingPresenceId: null,
          reason,
        });
      }
    }
  };

  const clearFollowEdges = (socketId: string, reason: string) => {
    clearFollower(socketId, reason, false);
    const followers = Array.from(followersBySocket.get(socketId) || []);
    followersBySocket.delete(socketId);
    for (const followerId of followers) {
      if (followingBySocket.get(followerId) !== socketId) continue;
      followingBySocket.delete(followerId);
      const drawingId = drawingBySocket.get(followerId);
      if (drawingId) {
        io.to(followerId).emit("follow-status", {
          drawingId,
          followingPresenceId: null,
          reason,
        });
      }
    }
  };

  const removeFromDrawing = async (
    socket: Socket,
    reason: string,
    leaveSocketRoom = true,
  ) => {
    const drawingId = drawingBySocket.get(socket.id);
    if (!drawingId) return;
    clearFollowEdges(socket.id, reason);
    viewportSequenceBySocket.delete(socket.id);
    drawingBySocket.delete(socket.id);
    const presences = presencesByDrawing.get(drawingId);
    presences?.delete(socket.id);
    if (presences?.size === 0) presencesByDrawing.delete(drawingId);
    if (leaveSocketRoom) await socket.leave(roomName(drawingId));
    emitPresence(drawingId);
  };

  const getAccess = (socketId: string, drawingId: string) =>
    getDrawingAccess({
      prisma,
      principal: principals.get(socketId) || null,
      drawingId,
    });

  const requireAccess = async (
    socket: Socket,
    drawingId: string,
    requireEdit = false,
  ) => {
    if (
      drawingBySocket.get(socket.id) !== drawingId ||
      !socket.rooms.has(roomName(drawingId))
    ) {
      return null;
    }
    const access = await getAccess(socket.id, drawingId);
    if (!canViewDrawing(access)) {
      await removeFromDrawing(socket, "access-revoked");
      socket.emit("error", { message: "You do not have access to this drawing" });
      return null;
    }
    if (requireEdit && !canEditDrawing(access)) {
      socket.emit("error", { message: "Read-only access: cannot edit this drawing" });
      return null;
    }
    return access;
  };

  io.on("connection", (socket) => {
    connectedSockets.set(socket.id, socket);
    const allowJoin = createRateLimiter(10, 60_000);
    const allowCursor = createRateLimiter(40, 1_000);
    const allowElements = createRateLimiter(120, 1_000);
    const allowActivity = createRateLimiter(20, 10_000);
    const allowFollow = createRateLimiter(12, 60_000);
    const allowViewport = createRateLimiter(30, 1_000);

    socket.on("join-room", async (data: unknown, ack?: (value: unknown) => void) => {
      if (!allowJoin() || !data || typeof data !== "object") return;
      const payload = data as Record<string, unknown>;
      const drawingId = parseDrawingId(payload.drawingId);
      if (!drawingId) return;
      const access = await getAccess(socket.id, drawingId);
      if (!canViewDrawing(access)) {
        socket.emit("error", { message: "You do not have access to this drawing" });
        return;
      }
      const previousDrawingId = drawingBySocket.get(socket.id);
      if (previousDrawingId && previousDrawingId !== drawingId) {
        await removeFromDrawing(socket, "board-changed");
      }
      await socket.join(roomName(drawingId));
      const clientUser =
        payload.user && typeof payload.user === "object"
          ? (payload.user as Record<string, unknown>)
          : {};
      const principal = principals.get(socket.id) || null;
      let name = toPresenceName(clientUser.name);
      if (principal?.userId && principal.userId !== BOOTSTRAP_USER_ID) {
        const account = await prisma.user.findUnique({
          where: { id: principal.userId },
          select: { name: true },
        });
        if (account) name = toPresenceName(account.name);
      }
      const presence: PresenceUser = {
        presenceId: socket.id,
        accountId: principal?.userId || null,
        name,
        initials: toPresenceInitials(name),
        color: toPresenceColor(clientUser.color),
        isActive: true,
      };
      drawingBySocket.set(socket.id, drawingId);
      const presences = presencesByDrawing.get(drawingId) || new Map();
      presences.set(socket.id, presence);
      presencesByDrawing.set(drawingId, presences);
      emitPresence(drawingId);
      ack?.({ presence });
    });

    socket.on("cursor-move", async (data: unknown) => {
      if (!allowCursor()) return;
      const payload = parseCursorPayload(data);
      if (!payload || !(await requireAccess(socket, payload.drawingId))) return;
      const self = getPresence(socket.id);
      if (!self) return;
      socket.volatile.to(roomName(payload.drawingId)).emit("cursor-move", {
        drawingId: payload.drawingId,
        presenceId: socket.id,
        pointer: payload.pointer,
        button: payload.button,
        username: self.name,
        color: self.color,
      });
    });

    socket.on("element-update", async (data: unknown) => {
      if (!allowElements()) return;
      const payload = parseElementUpdatePayload(data);
      if (!payload || !(await requireAccess(socket, payload.drawingId, true))) return;
      socket.to(roomName(payload.drawingId)).emit("element-update", {
        elements: payload.elements,
        files: payload.files,
        elementOrder: payload.elementOrder,
      });
    });

    socket.on("user-activity", async (data: unknown) => {
      if (!allowActivity() || !data || typeof data !== "object") return;
      const payload = data as Record<string, unknown>;
      const drawingId = parseDrawingId(payload.drawingId);
      if (
        !drawingId ||
        typeof payload.isActive !== "boolean" ||
        !(await requireAccess(socket, drawingId))
      ) {
        return;
      }
      const user = presencesByDrawing.get(drawingId)?.get(socket.id);
      if (user) {
        user.isActive = payload.isActive;
        emitPresence(drawingId);
      }
    });

    socket.on("follow-user", async (data: unknown) => {
      if (!allowFollow() || !data || typeof data !== "object") return;
      const payload = data as Record<string, unknown>;
      const drawingId = parseDrawingId(payload.drawingId);
      if (!drawingId || !(await requireAccess(socket, drawingId))) return;
      if (payload.action === "UNFOLLOW") {
        clearFollower(socket.id, "unfollowed", false);
        socket.emit("follow-status", { drawingId, followingPresenceId: null });
        return;
      }
      const targetId =
        typeof payload.targetPresenceId === "string" &&
        payload.targetPresenceId.length <= 200
          ? payload.targetPresenceId
          : null;
      if (payload.action !== "FOLLOW" || !targetId || targetId === socket.id) {
        socket.emit("follow-status", {
          drawingId,
          followingPresenceId: null,
          reason: targetId === socket.id ? "self-follow" : "invalid-request",
        });
        return;
      }
      const targetSocket = connectedSockets.get(targetId);
      if (
        !targetSocket ||
        drawingBySocket.get(targetId) !== drawingId ||
        !targetSocket.rooms.has(roomName(drawingId))
      ) {
        socket.emit("follow-status", {
          drawingId,
          followingPresenceId: null,
          reason: "target-unavailable",
        });
        return;
      }
      const targetAccess = await getAccess(targetId, drawingId);
      if (!canViewDrawing(targetAccess)) {
        await removeFromDrawing(targetSocket, "access-revoked");
        socket.emit("follow-status", {
          drawingId,
          followingPresenceId: null,
          reason: "target-unavailable",
        });
        return;
      }
      clearFollower(socket.id, "target-changed", false);
      followingBySocket.set(socket.id, targetId);
      const followers = followersBySocket.get(targetId) || new Set<string>();
      followers.add(socket.id);
      followersBySocket.set(targetId, followers);
      emitFollowedBy(targetId);
      socket.emit("follow-status", { drawingId, followingPresenceId: targetId });
    });

    socket.on("viewport-bounds", async (data: unknown) => {
      if (!allowViewport() || !data || typeof data !== "object") return;
      const payload = data as Record<string, unknown>;
      const drawingId = parseDrawingId(payload.drawingId);
      const sceneBounds = parseSceneBounds(payload.sceneBounds);
      if (!drawingId || !sceneBounds || !(await requireAccess(socket, drawingId))) {
        return;
      }
      const sequence = (viewportSequenceBySocket.get(socket.id) || 0) + 1;
      viewportSequenceBySocket.set(socket.id, sequence);
      for (const followerId of Array.from(followersBySocket.get(socket.id) || [])) {
        const followerSocket = connectedSockets.get(followerId);
        if (
          !followerSocket ||
          followingBySocket.get(followerId) !== socket.id ||
          drawingBySocket.get(followerId) !== drawingId ||
          !followerSocket.rooms.has(roomName(drawingId))
        ) {
          clearFollower(followerId, "relationship-invalid", false);
          continue;
        }
        const followerAccess = await getAccess(followerId, drawingId);
        if (!canViewDrawing(followerAccess)) {
          await removeFromDrawing(followerSocket, "access-revoked");
          continue;
        }
        io.to(followerId).volatile.emit("viewport-bounds", {
          drawingId,
          presenceId: socket.id,
          sceneBounds,
          sequence,
        });
      }
    });

    socket.on("leave-room", async (data: unknown) => {
      if (!allowJoin()) return;
      const drawingId =
        data && typeof data === "object"
          ? parseDrawingId((data as Record<string, unknown>).drawingId)
          : null;
      if (drawingId && drawingBySocket.get(socket.id) === drawingId) {
        await removeFromDrawing(socket, "left-room");
      }
    });

    socket.on("disconnect", async () => {
      await removeFromDrawing(socket, "disconnected", false);
      connectedSockets.delete(socket.id);
      principals.delete(socket.id);
    });
  });
};
