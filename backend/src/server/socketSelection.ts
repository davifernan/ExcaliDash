import type { Socket } from "socket.io";
import type { PresenceRegistry } from "./presenceRegistry";
import { parseDrawingId } from "./socketProtocol";
import { registerAuthorizedRoomEvent, type RoomEventPayload } from "./socketRoomEvent";

export const SELECTION_LIMITS = {
  ids: 256,
  idLength: 200,
  eventsPerSecond: 40,
} as const;

export type SelectionPayload = RoomEventPayload & { selectedElementIds: string[] };

export const parseSelectionPayload = (value: unknown): SelectionPayload | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const drawingId = parseDrawingId(data.drawingId);
  if (!drawingId || !Array.isArray(data.selectedElementIds)) return null;
  if (
    data.selectedElementIds.length > SELECTION_LIMITS.ids ||
    !data.selectedElementIds.every(
      (id) => typeof id === "string" && id.length > 0 && id.length <= SELECTION_LIMITS.idLength,
    )
  ) {
    return null;
  }
  return { drawingId, selectedElementIds: data.selectedElementIds };
};

const roomName = (drawingId: string) => `drawing_${drawingId}`;

export const registerSelectionRoomEvent = ({
  socket,
  presences,
  requireAccess,
  allow,
}: {
  socket: Socket;
  presences: PresenceRegistry;
  requireAccess: (socket: Socket, drawingId: string, requireEdit?: boolean) => Promise<unknown>;
  allow?: () => boolean;
}): void => {
  registerAuthorizedRoomEvent({
    socket,
    event: "selection-update",
    limit: SELECTION_LIMITS.eventsPerSecond,
    windowMs: 1_000,
    parse: parseSelectionPayload,
    requireAccess,
    allow,
    handle: (payload) => {
      if (!presences.setSelection(payload.drawingId, socket.id, payload.selectedElementIds)) return;
      const selection = presences.get(payload.drawingId, socket.id)?.selectedElementIds;
      if (!selection) return;
      socket.to(roomName(payload.drawingId)).emit("selection-update", {
        drawingId: payload.drawingId,
        presenceId: socket.id,
        selectedElementIds: selection,
      });
    },
  });
};
