import type { Socket } from "socket.io-client";
import { buildRemoteSceneUpdate } from "./shared";
import { parseRemoteSelectedElementIds } from "./remoteSelection";

export interface Peer {
  presenceId: string;
  // No account id: the server keeps that to itself, because a share link puts
  // anonymous visitors in the same room as everyone else.
  name: string;
  initials: string;
  color: string;
  isActive: boolean;
  selectedElementIds?: Record<string, true>;
}

type ExcalidrawApi = {
  getAppState: () => any;
  updateScene: (scene: any) => void;
};

export const bindSocketCollaborators = ({
  socket,
  api,
  onPeersChange,
  decorateName = (name) => name,
}: {
  socket: Socket;
  api: ExcalidrawApi;
  onPeersChange: (peers: Peer[]) => void;
  /**
   * A last say over the name Excalidraw paints beside each cursor.
   *
   * Cursor chat rides on this: Excalidraw already draws a name there and moves
   * it with the pointer, so a message appended to the name follows the cursor
   * exactly, with no renderer of ours to keep in step.
   */
  decorateName?: (name: string, presenceId: string) => string;
}) => {
  let selfPresenceId: string | null = null;
  let lastPresenceUsers: Peer[] | null = null;
  let knownPresenceIds = new Set<string>();
  const cursorBuffer = new Map<string, any>();
  let animationFrameId = 0;

  const updateCollaborators = (collaborators: Map<string, any>) => {
    const { sceneUpdate } = buildRemoteSceneUpdate({ collaborators });
    if (sceneUpdate) api.updateScene(sceneUpdate);
  };

  /**
   * Runs only while there is something to draw.
   *
   * It used to schedule the next frame unconditionally, so an idle editor kept
   * a sixty-times-a-second loop alive doing nothing at all. A cursor arriving
   * starts it; an empty buffer lets it stop.
   */
  const renderCursors = () => {
    animationFrameId = 0;
    if (cursorBuffer.size > 0) {
      const collaborators = new Map<string, any>(api.getAppState().collaborators || []);
      cursorBuffer.forEach((data, presenceId) => {
        collaborators.set(presenceId, {
          ...(collaborators.get(presenceId) || {}),
          ...data,
          username: decorateName(data.username, presenceId),
        });
      });
      cursorBuffer.clear();
      updateCollaborators(collaborators);
      // One more frame, in case cursors arrived while this one was drawing.
      animationFrameId = requestAnimationFrame(renderCursors);
    }
  };

  const wake = () => {
    if (animationFrameId === 0) animationFrameId = requestAnimationFrame(renderCursors);
  };

  const onPresence = (users: Peer[]) => {
    if (!Array.isArray(users)) return;
    lastPresenceUsers = users;
    const selfId = selfPresenceId || socket.id;
    onPeersChange(users.filter((user) => user.presenceId !== selfId));
    const collaborators = new Map<string, any>(api.getAppState().collaborators || []);
    const nextPresenceIds = new Set(
      users.filter((user) => user.presenceId !== selfId).map((user) => user.presenceId),
    );
    knownPresenceIds.forEach((presenceId) => {
      if (!nextPresenceIds.has(presenceId)) collaborators.delete(presenceId);
    });
    users.forEach((user) => {
      if (user.presenceId === selfId) return;
      if (!user.isActive) {
        collaborators.delete(user.presenceId);
        return;
      }
      const existing = collaborators.get(user.presenceId) || {};
      const selectedElementIds = parseRemoteSelectedElementIds(user.selectedElementIds);
      collaborators.set(user.presenceId, {
        ...existing,
        id: user.presenceId,
        username: decorateName(user.name, user.presenceId),
        color: { background: user.color, stroke: user.color },
        isCurrentUser: false,
        selectedElementIds: selectedElementIds || existing.selectedElementIds || {},
      });
    });
    knownPresenceIds = nextPresenceIds;
    updateCollaborators(collaborators);
  };

  const onCursor = (data: any) => {
    if (typeof data?.presenceId !== "string") return;
    cursorBuffer.set(data.presenceId, {
      pointer: data.pointer,
      button: data.button || "up",
      username: data.username,
      color: { background: data.color, stroke: data.color },
      id: data.presenceId,
    });
    wake();
  };

  socket.on("presence-update", onPresence);
  socket.on("cursor-move", onCursor);

  const reset = () => {
    selfPresenceId = null;
    lastPresenceUsers = null;
    knownPresenceIds.clear();
    cursorBuffer.clear();
    onPeersChange([]);
    updateCollaborators(new Map());
  };

  /**
   * Re-apply the last presence list.
   *
   * Names are only rebuilt when presence or a cursor arrives. Cursor chat can
   * change what a name should say while its owner sits perfectly still, and
   * without this their message would wait for their next twitch.
   */
  const refresh = () => {
    if (lastPresenceUsers) onPresence(lastPresenceUsers);
  };

  return {
    refresh,
    setSelfPresenceId(presenceId: string) {
      selfPresenceId = presenceId;
      if (lastPresenceUsers) onPresence(lastPresenceUsers);
    },
    reset,
    dispose() {
      socket.off("presence-update", onPresence);
      socket.off("cursor-move", onCursor);
      cancelAnimationFrame(animationFrameId);
    },
  };
};
