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
import type { CollaborationAccessController } from "./collaborationAccess";
import { createSocketFollowManager } from "./socketFollow";
import {
  createApiKeySocketRevoker,
  registerApiKeySocketRevoker,
} from "./socketRevocation";
import { DRAWINGS_READ_SCOPE, DRAWINGS_WRITE_SCOPE } from "../auth/apiKeys";
import {
  createRateLimiter,
  parseCursorPayload,
  parseDrawingId,
  parseElementUpdatePayload,
  SOCKET_QUEUE_LIMITS,
  type PresenceUser,
} from "./socketProtocol";

type RegisterSocketHandlersDeps = {
  io: Server;
  prisma: PrismaClient;
  authModeService: AuthModeService;
  jwtSecret: string;
  accessRecheckIntervalMs?: number;
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
  accessRecheckIntervalMs = 5_000,
}: RegisterSocketHandlersDeps): CollaborationAccessController => {
  const principals = new Map<string, DrawingPrincipal>();
  const connectedSockets = new Map<string, Socket>();
  const drawingBySocket = new Map<string, string>();
  const presencesByDrawing = new Map<string, Map<string, PresenceUser>>();
  let followManager: ReturnType<typeof createSocketFollowManager>;

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

  const removeFromDrawing = async (
    socket: Socket,
    reason: string,
    leaveSocketRoom = true,
  ) => {
    const drawingId = drawingBySocket.get(socket.id);
    if (!drawingId) return;
    followManager.clearSocket(socket.id, reason);
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

  const apiKeyHasScope = (socketId: string, scope: string) => {
    const apiKey = principals.get(socketId)?.apiKey;
    return !apiKey || apiKey.scopes.includes(scope);
  };

  const canSocketView = (
    socketId: string,
    access: Awaited<ReturnType<typeof getAccess>>,
  ) =>
    canViewDrawing(access) &&
    apiKeyHasScope(socketId, DRAWINGS_READ_SCOPE);

  const canSocketEdit = (
    socketId: string,
    access: Awaited<ReturnType<typeof getAccess>>,
  ) =>
    canEditDrawing(access) &&
    apiKeyHasScope(socketId, DRAWINGS_WRITE_SCOPE);

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
    if (
      connectedSockets.get(socket.id) !== socket ||
      drawingBySocket.get(socket.id) !== drawingId ||
      !socket.rooms.has(roomName(drawingId))
    ) {
      return null;
    }
    if (!canSocketView(socket.id, access)) {
      await removeFromDrawing(socket, "access-revoked");
      socket.emit("error", { message: "You do not have access to this drawing" });
      return null;
    }
    if (requireEdit && !canSocketEdit(socket.id, access)) {
      socket.emit("error", { message: "Read-only access: cannot edit this drawing" });
      return null;
    }
    return access;
  };

  followManager = createSocketFollowManager({
    io,
    connectedSockets,
    drawingBySocket,
    getPresence,
    getAccess,
    requireAccess: (socket, drawingId) => requireAccess(socket, drawingId),
    removeFromDrawing: (socket, reason) => removeFromDrawing(socket, reason),
  });

  io.on("connection", (socket) => {
    connectedSockets.set(socket.id, socket);
    let joinRevision = 0;
    let joinQueue = Promise.resolve();
    let pendingJoins = 0;
    const allowJoin = createRateLimiter(10, 60_000);
    const allowCursor = createRateLimiter(40, 1_000);
    const allowElements = createRateLimiter(120, 1_000);
    const allowActivity = createRateLimiter(20, 10_000);
    const allowFollow = createRateLimiter(12, 60_000);
    const allowViewport = createRateLimiter(30, 1_000);
    followManager.registerHandlers(socket, allowFollow, allowViewport);

    socket.on("join-room", (data: unknown, ack?: (value: unknown) => void) => {
      const rejectJoin = (code: string, message: string) => {
        const error = { code, message };
        socket.emit("error", error);
        ack?.({ ok: false, error });
      };
      if (!allowJoin()) {
        rejectJoin("rate-limited", "Join room rate limit exceeded");
        return;
      }
      if (!data || typeof data !== "object") {
        rejectJoin("invalid-request", "Invalid join room request");
        return;
      }
      const payload = data as Record<string, unknown>;
      const drawingId = parseDrawingId(payload.drawingId);
      if (!drawingId) {
        rejectJoin("invalid-request", "Invalid drawing id");
        return;
      }
      if (pendingJoins >= SOCKET_QUEUE_LIMITS.joins) {
        rejectJoin("queue-full", "Too many pending join room requests");
        return;
      }
      pendingJoins += 1;
      const revision = ++joinRevision;
      const run = async () => {
        const isCurrentJoin = () =>
          connectedSockets.get(socket.id) === socket && revision === joinRevision;

        const access = await getAccess(socket.id, drawingId);
        if (!isCurrentJoin()) return;
        if (!canSocketView(socket.id, access)) {
          socket.emit("error", { message: "You do not have access to this drawing" });
          ack?.({
            ok: false,
            error: {
              code: "access-denied",
              message: "You do not have access to this drawing",
            },
          });
          return;
        }
        const previousDrawingId = drawingBySocket.get(socket.id);
        if (previousDrawingId && previousDrawingId !== drawingId) {
          await removeFromDrawing(socket, "board-changed");
          if (!isCurrentJoin()) return;
        }
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
          if (!isCurrentJoin()) return;
          if (account) name = toPresenceName(account.name);
        }
        await socket.join(roomName(drawingId));
        if (!isCurrentJoin()) {
          await socket.leave(roomName(drawingId));
          return;
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
        followManager.invalidateAccess(socket.id);
        ack?.({ ok: true, presence });
      };
      const result = joinQueue.then(run, run);
      joinQueue = result.then(
        () => {
          pendingJoins -= 1;
        },
        () => {
          pendingJoins -= 1;
        },
      );
      return result;
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

    socket.on("leave-room", async (data: unknown) => {
      joinRevision += 1;
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
      joinRevision += 1;
      connectedSockets.delete(socket.id);
      await removeFromDrawing(socket, "disconnected", false);
      principals.delete(socket.id);
    });
  });

  const recheckSockets = async (
    matches: (socketId: string, drawingId: string) => boolean,
  ) => {
    const candidates = Array.from(connectedSockets.values()).filter((socket) => {
      const drawingId = drawingBySocket.get(socket.id);
      return Boolean(drawingId && matches(socket.id, drawingId));
    });
    await Promise.all(
      candidates.map(async (socket) => {
        const drawingId = drawingBySocket.get(socket.id);
        if (!drawingId) return;
        followManager.invalidateAccess(socket.id);
        const access = await getAccess(socket.id, drawingId);
        if (
          !canSocketView(socket.id, access) &&
          connectedSockets.get(socket.id) === socket &&
          drawingBySocket.get(socket.id) === drawingId
        ) {
          await removeFromDrawing(socket, "access-revoked");
          socket.emit("error", {
            message: "You do not have access to this drawing",
          });
        }
      }),
    );
  };

  const disconnectApiKey = createApiKeySocketRevoker({
    connectedSockets,
    principals,
    removeFromDrawing,
  });

  const controller: CollaborationAccessController = {
    recheckDrawingAccess: (drawingId, affectedUserId) =>
      recheckSockets(
        (socketId, activeDrawingId) =>
          activeDrawingId === drawingId &&
          (!affectedUserId || principals.get(socketId)?.userId === affectedUserId),
      ),
    recheckUserAccess: (affectedUserId) =>
      recheckSockets(
        (socketId) => principals.get(socketId)?.userId === affectedUserId,
      ),
    disconnectApiKey,
  };

  registerApiKeySocketRevoker(disconnectApiKey);
  // Expiring link shares have no route invocation at expiry time. A periodic
  // server-side sweep bounds passive clients' access even if they send nothing.
  const accessRecheckTimer = setInterval(() => {
    void recheckSockets(() => true).catch((error) => {
      console.error("Periodic socket access recheck failed:", error);
    });
  }, accessRecheckIntervalMs);
  accessRecheckTimer.unref?.();

  return controller;
};
