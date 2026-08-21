import type { Socket } from "socket.io-client";
import type { UserIdentity } from "../../utils/identity";

type JoinedPresence = { presenceId: string };

const JOIN_ACK_TIMEOUT_MS = 2_000;
const JOIN_RETRY_DELAY_MS = 250;

export const bindSocketRoomLifecycle = ({
  socket,
  drawingId,
  shareToken,
  user,
  resetConnectionState,
  onJoined,
  getFollowTargetPresenceId,
}: {
  socket: Socket;
  drawingId: string;
  shareToken: string | null;
  user: UserIdentity;
  resetConnectionState: () => void;
  onJoined: (presence: JoinedPresence) => void;
  getFollowTargetPresenceId: () => string | null;
}) => {
  let joinedSocketId: string | null = null;
  let joiningSocketId: string | null = null;
  let resetSocketId: string | null = null;
  let ackTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer !== null) clearTimeout(timer);
  };

  const scheduleRetry = (socketId: string) => {
    clearTimer(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!disposed && socket.connected && socket.id === socketId) {
        joinCurrentConnection();
      }
    }, JOIN_RETRY_DELAY_MS);
  };

  const joinCurrentConnection = () => {
    const socketId = socket.id;
    if (!socketId || disposed || joinedSocketId === socketId || joiningSocketId === socketId) {
      return;
    }
    if (resetSocketId !== socketId) {
      resetSocketId = socketId;
      resetConnectionState();
    }
    joiningSocketId = socketId;
    let settled = false;
    clearTimer(ackTimer);
    ackTimer = setTimeout(() => {
      if (settled || socket.id !== socketId) return;
      settled = true;
      joiningSocketId = null;
      scheduleRetry(socketId);
    }, JOIN_ACK_TIMEOUT_MS);
    socket.emit("join-room", { drawingId, shareToken, user }, (payload: any) => {
      if (settled || socket.id !== socketId) return;
      settled = true;
      clearTimer(ackTimer);
      ackTimer = null;
      joiningSocketId = null;
      const presence = payload?.presence;
      if (!presence || typeof presence.presenceId !== "string") {
        if (payload?.error?.code !== "access-denied") scheduleRetry(socketId);
        return;
      }
      joinedSocketId = socketId;
      onJoined(presence);
      const targetPresenceId = getFollowTargetPresenceId();
      if (targetPresenceId) {
        socket.emit("follow-user", {
          drawingId,
          targetPresenceId,
          action: "FOLLOW",
        });
      }
    });
  };

  const onDisconnect = () => {
    clearTimer(ackTimer);
    clearTimer(retryTimer);
    ackTimer = null;
    retryTimer = null;
    joinedSocketId = null;
    joiningSocketId = null;
    resetSocketId = null;
    resetConnectionState();
  };

  socket.on("connect", joinCurrentConnection);
  socket.on("disconnect", onDisconnect);
  if (socket.connected) joinCurrentConnection();

  return () => {
    disposed = true;
    clearTimer(ackTimer);
    clearTimer(retryTimer);
    socket.off("connect", joinCurrentConnection);
    socket.off("disconnect", onDisconnect);
  };
};
