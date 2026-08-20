import type { Socket } from "socket.io-client";
import type { UserIdentity } from "../../utils/identity";

type JoinedPresence = { presenceId: string };

export const bindSocketRoomLifecycle = ({
  socket,
  drawingId,
  user,
  resetConnectionState,
  onJoined,
  getFollowTargetPresenceId,
}: {
  socket: Socket;
  drawingId: string;
  user: UserIdentity;
  resetConnectionState: () => void;
  onJoined: (presence: JoinedPresence) => void;
  getFollowTargetPresenceId: () => string | null;
}) => {
  let joinedSocketId: string | null = null;

  const joinCurrentConnection = () => {
    const socketId = socket.id;
    if (!socketId || joinedSocketId === socketId) return;
    joinedSocketId = socketId;
    resetConnectionState();
    socket.emit("join-room", { drawingId, user }, (payload: any) => {
      if (socket.id !== socketId) return;
      const presence = payload?.presence;
      if (!presence || typeof presence.presenceId !== "string") return;
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
    joinedSocketId = null;
    resetConnectionState();
  };

  socket.on("connect", joinCurrentConnection);
  socket.on("disconnect", onDisconnect);
  if (socket.connected) joinCurrentConnection();

  return () => {
    socket.off("connect", joinCurrentConnection);
    socket.off("disconnect", onDisconnect);
  };
};
