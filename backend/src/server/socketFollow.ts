import type { Server, Socket } from "socket.io";
import { canViewDrawing, type DrawingAccess } from "../authz/sharing";
import { parseDrawingId, parseSceneBounds, type PresenceUser } from "./socketProtocol";

type SocketFollowManagerDeps = {
  io: Server;
  connectedSockets: Map<string, Socket>;
  drawingBySocket: Map<string, string>;
  getPresence: (socketId: string) => PresenceUser | null;
  getAccess: (socketId: string, drawingId: string) => Promise<DrawingAccess>;
  requireAccess: (socket: Socket, drawingId: string) => Promise<DrawingAccess | null>;
  removeFromDrawing: (socket: Socket, reason: string) => Promise<void>;
};

const roomName = (drawingId: string) => `drawing_${drawingId}`;

export const createSocketFollowManager = ({
  io,
  connectedSockets,
  drawingBySocket,
  getPresence,
  getAccess,
  requireAccess,
  removeFromDrawing,
}: SocketFollowManagerDeps) => {
  const followingBySocket = new Map<string, string>();
  const followersBySocket = new Map<string, Set<string>>();
  const viewportSequenceBySocket = new Map<string, number>();

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

  const emitFollowStatus = (socket: Socket, drawingId: string, reason?: string) => {
    const targetId = followingBySocket.get(socket.id);
    socket.emit("follow-status", {
      drawingId,
      followingPresenceId:
        targetId && drawingBySocket.get(targetId) === drawingId ? targetId : null,
      ...(reason ? { reason } : {}),
    });
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
    if (!notifyFollower) return;
    const drawingId = drawingBySocket.get(followerId);
    if (drawingId) {
      io.to(followerId).emit("follow-status", {
        drawingId,
        followingPresenceId: null,
        reason,
      });
    }
  };

  const clearSocket = (socketId: string, reason: string) => {
    clearFollower(socketId, reason, false);
    viewportSequenceBySocket.delete(socketId);
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

  const wouldCreateCycle = (followerId: string, targetId: string) => {
    const visited = new Set<string>();
    let currentId: string | undefined = targetId;
    while (currentId && !visited.has(currentId)) {
      if (currentId === followerId) return true;
      visited.add(currentId);
      currentId = followingBySocket.get(currentId);
    }
    return false;
  };

  const registerHandlers = (
    socket: Socket,
    allowFollow: () => boolean,
    allowViewport: () => boolean,
  ) => {
    let followQueue = Promise.resolve();
    socket.on("follow-user", (data: unknown) => {
      const rateLimitAccepted = allowFollow();
      const run = async () => {
        if (!data || typeof data !== "object") return;
        const payload = data as Record<string, unknown>;
        const drawingId = parseDrawingId(payload.drawingId);
        if (!drawingId) return;
        if (!rateLimitAccepted) {
          emitFollowStatus(socket, drawingId, "rate-limited");
          return;
        }
        if (!(await requireAccess(socket, drawingId))) return;
        if (payload.action === "UNFOLLOW") {
          clearFollower(socket.id, "unfollowed", false);
          emitFollowStatus(socket, drawingId);
          return;
        }
        const targetId =
          typeof payload.targetPresenceId === "string" &&
          payload.targetPresenceId.length <= 200
            ? payload.targetPresenceId
            : null;
        if (payload.action !== "FOLLOW" || !targetId || targetId === socket.id) {
          emitFollowStatus(
            socket,
            drawingId,
            targetId === socket.id ? "self-follow" : "invalid-request",
          );
          return;
        }
        const targetSocket = connectedSockets.get(targetId);
        if (
          !targetSocket ||
          drawingBySocket.get(targetId) !== drawingId ||
          !targetSocket.rooms.has(roomName(drawingId))
        ) {
          emitFollowStatus(socket, drawingId, "target-unavailable");
          return;
        }
        const targetAccess = await getAccess(targetId, drawingId);
        if (
          connectedSockets.get(socket.id) !== socket ||
          drawingBySocket.get(socket.id) !== drawingId
        ) {
          return;
        }
        if (!canViewDrawing(targetAccess)) {
          if (connectedSockets.get(targetId) === targetSocket) {
            await removeFromDrawing(targetSocket, "access-revoked");
          }
          emitFollowStatus(socket, drawingId, "target-unavailable");
          return;
        }
        if (
          connectedSockets.get(targetId) !== targetSocket ||
          drawingBySocket.get(targetId) !== drawingId ||
          !targetSocket.rooms.has(roomName(drawingId))
        ) {
          emitFollowStatus(socket, drawingId, "target-unavailable");
          return;
        }
        if (wouldCreateCycle(socket.id, targetId)) {
          emitFollowStatus(socket, drawingId, "cycle-detected");
          return;
        }
        clearFollower(socket.id, "target-changed", false);
        followingBySocket.set(socket.id, targetId);
        const followers = followersBySocket.get(targetId) || new Set<string>();
        followers.add(socket.id);
        followersBySocket.set(targetId, followers);
        emitFollowedBy(targetId);
        emitFollowStatus(socket, drawingId);
      };
      const result = followQueue.then(run, run);
      followQueue = result.then(() => undefined, () => undefined);
      return result;
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
        if (
          connectedSockets.get(followerId) !== followerSocket ||
          followingBySocket.get(followerId) !== socket.id ||
          drawingBySocket.get(followerId) !== drawingId ||
          !followerSocket.rooms.has(roomName(drawingId))
        ) {
          clearFollower(followerId, "relationship-invalid", false);
          continue;
        }
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
  };

  return { clearSocket, registerHandlers };
};
