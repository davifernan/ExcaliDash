import type { Socket } from "socket.io-client";
import { buildRemoteSceneUpdate } from "./shared";

export const REMOTE_SELECTION_LIMITS = { ids: 256, idLength: 200 } as const;
const SELECTION_THROTTLE_MS = 50;

type ExcalidrawApi = {
  getAppState: () => any;
  updateScene: (scene: any) => void;
};

export const parseRemoteSelectedElementIds = (value: unknown): Record<string, true> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (
    entries.length > REMOTE_SELECTION_LIMITS.ids ||
    !entries.every(
      ([id, selected]) =>
        id.length > 0 && id.length <= REMOTE_SELECTION_LIMITS.idLength && selected === true,
    )
  ) {
    return null;
  }
  return Object.fromEntries(entries) as Record<string, true>;
};

const selectedIdsFromAppState = (appState: any): string[] =>
  Object.entries(appState?.selectedElementIds || {})
    .filter(
      ([id, selected]) =>
        selected === true && id.length > 0 && id.length <= REMOTE_SELECTION_LIMITS.idLength,
    )
    .map(([id]) => id)
    .sort()
    .slice(0, REMOTE_SELECTION_LIMITS.ids);

export const bindRemoteSelection = ({
  socket,
  drawingId,
  api,
  throttleMs = SELECTION_THROTTLE_MS,
}: {
  socket: Socket;
  drawingId: string;
  api: ExcalidrawApi;
  throttleMs?: number;
}) => {
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let lastSentSignature: string | null = null;
  let pendingIds: string[] | null = null;
  let sendTimer: ReturnType<typeof setTimeout> | null = null;

  const send = (ids: string[]) => {
    lastSentAt = Date.now();
    lastSentSignature = JSON.stringify(ids);
    socket.emit("selection-update", { drawingId, selectedElementIds: ids });
  };

  const clearTimer = () => {
    if (sendTimer !== null) clearTimeout(sendTimer);
    sendTimer = null;
  };

  const publish = (appState: any) => {
    const ids = selectedIdsFromAppState(appState);
    const signature = JSON.stringify(ids);
    if (signature === lastSentSignature) {
      pendingIds = null;
      clearTimer();
      return;
    }
    const remaining = throttleMs - (Date.now() - lastSentAt);
    if (remaining <= 0) {
      pendingIds = null;
      clearTimer();
      send(ids);
      return;
    }
    pendingIds = ids;
    if (sendTimer !== null) return;
    sendTimer = setTimeout(() => {
      sendTimer = null;
      const nextIds = pendingIds;
      pendingIds = null;
      if (nextIds) send(nextIds);
    }, remaining);
  };

  const onSelection = (payload: any) => {
    if (payload?.drawingId !== drawingId || typeof payload?.presenceId !== "string") return;
    const selectedElementIds = parseRemoteSelectedElementIds(payload.selectedElementIds);
    if (!selectedElementIds) return;
    const collaborators = new Map<string, any>(api.getAppState().collaborators || []);
    const existing = collaborators.get(payload.presenceId) || { id: payload.presenceId };
    collaborators.set(payload.presenceId, { ...existing, selectedElementIds });
    const { sceneUpdate } = buildRemoteSceneUpdate({ collaborators });
    if (sceneUpdate) api.updateScene(sceneUpdate);
  };

  const reset = () => {
    clearTimer();
    pendingIds = null;
    lastSentAt = Number.NEGATIVE_INFINITY;
    lastSentSignature = null;
  };

  socket.on("selection-update", onSelection);
  return {
    publish,
    reset,
    dispose() {
      reset();
      socket.off("selection-update", onSelection);
    },
  };
};
