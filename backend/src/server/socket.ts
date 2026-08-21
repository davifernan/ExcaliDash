import type { Server, Socket } from "socket.io";
import type { PrismaClient } from "../generated/client";
import type { AuthModeService } from "../auth/authMode";
import {
  canEditDrawing,
  canViewDrawing,
  getDrawingAccess,
  parseShareLinkToken,
  type DrawingPrincipal,
} from "../authz/sharing";
import { createSocketAuthenticator } from "./socketAuth";
import {
  createCollaborationAccessController,
  type CollaborationAccessController,
} from "./collaborationAccess";
import { createSocketFollowManager } from "./socketFollow";
import {
  createApiKeySocketRevoker,
  registerApiKeySocketRevoker,
  registerUserSocketRechecker,
} from "./socketRevocation";
import { DRAWINGS_READ_SCOPE, DRAWINGS_WRITE_SCOPE } from "../auth/apiKeys";
import { startNonOverlappingSocketAccessSweep } from "./socketAccessSweep";
import { createSocketCredentialGuard } from "./socketCredentials";
import {
  derivePresenceColor,
  deriveGuestName,
  toPresenceColor,
  toPresenceInitials,
  toPresenceName,
} from "./socketPresence";
import { PresenceRegistry, type PresenceEntry, type PresenceKind } from "./presenceRegistry";
import {
  createRateLimiter,
  parseCursorPayload,
  parseDrawingId,
  parseElementUpdatePayload,
  SOCKET_QUEUE_LIMITS,
} from "./socketProtocol";
import { ActiveAccountCache } from "./activeAccountCache";

type RegisterSocketHandlersDeps = {
  io: Server;
  prisma: PrismaClient;
  authModeService: AuthModeService;
  jwtSecret: string;
  accessRecheckIntervalMs?: number;
  /** Shared with the HTTP side so the dashboard can read presence too. */
  presences?: PresenceRegistry;
};

const roomName = (drawingId: string) => `drawing_${drawingId}`;

export const registerSocketHandlers = ({
  io,
  prisma,
  authModeService,
  jwtSecret,
  accessRecheckIntervalMs = 5_000,
  presences = new PresenceRegistry(),
}: RegisterSocketHandlersDeps): CollaborationAccessController => {
  const principals = new Map<string, DrawingPrincipal>();
  const connectedSockets = new Map<string, Socket>();
  const credentialChecks = new Map<string, Promise<boolean>>();
  const drawingBySocket = new Map<string, string>();
  const shareTokenBySocket = new Map<string, string>();
  let followManager: ReturnType<typeof createSocketFollowManager>;
  const activeAccounts = new ActiveAccountCache(async (userId) => {
    const account = await prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true },
    });
    return Boolean(account?.isActive);
  });

  io.use(createSocketAuthenticator({ prisma, authModeService, jwtSecret, principals }));

  const emitPresence = (drawingId: string) => {
    io.to(roomName(drawingId)).emit("presence-update", presences.list(drawingId));
  };

  const getPresence = (socketId: string): PresenceEntry | null => {
    const drawingId = drawingBySocket.get(socketId);
    return drawingId ? presences.get(drawingId, socketId) : null;
  };

  const removeFromDrawing = async (socket: Socket, reason: string, leaveSocketRoom = true) => {
    const drawingId = drawingBySocket.get(socket.id);
    shareTokenBySocket.delete(socket.id);
    if (!drawingId) return;
    followManager.clearSocket(socket.id, reason);
    drawingBySocket.delete(socket.id);
    presences.leave(drawingId, socket.id);
    if (leaveSocketRoom) await socket.leave(roomName(drawingId));
    emitPresence(drawingId);
  };

  const getAccess = (socketId: string, drawingId: string, shareToken?: string | null) =>
    getDrawingAccess({
      prisma,
      principal: principals.get(socketId) || null,
      drawingId,
      isUserActive: (userId) => activeAccounts.get(userId),
      shareToken: shareToken === undefined ? shareTokenBySocket.get(socketId) : shareToken,
    });

  const apiKeyHasScope = (socketId: string, scope: string) => {
    const apiKey = principals.get(socketId)?.apiKey;
    return !apiKey || apiKey.scopes.includes(scope);
  };

  const canSocketView = (socketId: string, access: Awaited<ReturnType<typeof getAccess>>) =>
    canViewDrawing(access) && apiKeyHasScope(socketId, DRAWINGS_READ_SCOPE);

  const canSocketEdit = (socketId: string, access: Awaited<ReturnType<typeof getAccess>>) =>
    canEditDrawing(access) && apiKeyHasScope(socketId, DRAWINGS_WRITE_SCOPE);

  const requireAccess = async (socket: Socket, drawingId: string, requireEdit = false) => {
    if (drawingBySocket.get(socket.id) !== drawingId || !socket.rooms.has(roomName(drawingId))) {
      return null;
    }
    if (!(await credentialChecks.get(socket.id))) return null;
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

  const disconnectApiKey = createApiKeySocketRevoker({
    connectedSockets,
    principals,
    removeFromDrawing,
  });
  const credentialGuard = createSocketCredentialGuard({
    prisma,
    connectedSockets,
    principals,
    removeFromDrawing,
    disconnectApiKey,
  });

  io.on("connection", (socket) => {
    // Registration precedes the final credential read. A concurrent revoke
    // must therefore either find this socket in the map or win the final read;
    // there is no gap in which both mechanisms can miss it.
    connectedSockets.set(socket.id, socket);
    const credentialCheck = credentialGuard.verifyRegisteredSocket(socket);
    credentialChecks.set(socket.id, credentialCheck);
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
      const shareToken = parseShareLinkToken(payload.shareToken);
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

        if (!(await credentialCheck) || !isCurrentJoin()) {
          ack?.({
            ok: false,
            error: {
              code: "authentication-failed",
              message: "Authentication failed",
            },
          });
          return;
        }
        const access = await getAccess(socket.id, drawingId, shareToken);
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
        // Auth switched off gives every visitor the same standing identity,
        // which is another way of saying nobody has one. That is the only case
        // where the browser's own name and colour are all anyone has -- and it
        // is told apart by allowInactive, which the authenticator sets for
        // exactly that principal. The bootstrap *id* is no signal: once auth is
        // on, it belongs to a real administrator with a real name.
        const isSharedBootstrapIdentity = principal?.allowInactive === true;
        const isAccount = Boolean(principal?.userId) && !isSharedBootstrapIdentity;
        let name = toPresenceName(clientUser.name);
        let color = derivePresenceColor(socket.id);
        let kind: PresenceKind = "guest";
        if (isAccount && principal) {
          // An account has a name the server can check. A share-link visitor
          // does not, so the server names them rather than repeat their claim.
          const account = await prisma.user.findUnique({
            where: { id: principal.userId },
            select: { name: true },
          });
          if (!isCurrentJoin()) return;
          if (account) name = toPresenceName(account.name);
          color = derivePresenceColor(principal.userId);
          kind = access === "owner" ? "owner" : "member";
        } else if (isSharedBootstrapIdentity) {
          color = toPresenceColor(clientUser.color);
        } else {
          name = deriveGuestName(socket.id);
        }
        await socket.join(roomName(drawingId));
        if (!isCurrentJoin()) {
          await socket.leave(roomName(drawingId));
          return;
        }
        const presence: PresenceEntry = {
          presenceId: socket.id,
          accountId: principal?.userId || null,
          name,
          initials: toPresenceInitials(name),
          color,
          kind,
          isActive: true,
        };
        drawingBySocket.set(socket.id, drawingId);
        if (shareToken) shareTokenBySocket.set(socket.id, shareToken);
        else shareTokenBySocket.delete(socket.id);
        presences.join(drawingId, presence);
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
      presences.setActive(drawingId, socket.id, payload.isActive);
      // Emitted on every ping, including the ones that change nothing.
      // Suppressing the redundant ones looks free and is not: each presence
      // update is a scene update on the receiving side, and the sticky note
      // upkeep rides on those change events to settle its font size. Without
      // them a note that outgrew its paper stays outgrown for a second or two
      // instead of a frame. That dependency deserves fixing in the note code
      // rather than working around here -- until it is, the noise stays.
      emitPresence(drawingId);
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
      credentialChecks.delete(socket.id);
      shareTokenBySocket.delete(socket.id);
      await removeFromDrawing(socket, "disconnected", false);
      principals.delete(socket.id);
    });
  });

  const recheckSockets = async (matches: (socketId: string, drawingId: string) => boolean) => {
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

  const controller = createCollaborationAccessController({
    prisma,
    principals,
    recheckSockets,
    disconnectInactiveUserSockets: credentialGuard.disconnectInactiveUserSockets,
    disconnectApiKey,
    invalidateUserStatus: (userId) => activeAccounts.invalidate(userId),
  });

  registerApiKeySocketRevoker(disconnectApiKey);
  registerUserSocketRechecker(controller.recheckUserAccess);
  // Expiring link shares have no route invocation at expiry time. A periodic
  // server-side sweep bounds passive clients' access even if they send nothing.
  startNonOverlappingSocketAccessSweep(() => recheckSockets(() => true), accessRecheckIntervalMs);

  return controller;
};
