import type { Socket } from "socket.io";
import { createRateLimiter } from "./socketProtocol";

export type RoomEventPayload = { drawingId: string };

type RegisterAuthorizedRoomEventOptions<Payload extends RoomEventPayload> = {
  socket: Socket;
  event: string;
  limit: number;
  windowMs: number;
  parse: (value: unknown) => Payload | null;
  requireAccess: (socket: Socket, drawingId: string, requireEdit?: boolean) => Promise<unknown>;
  requireEdit?: boolean;
  handle: (payload: Payload) => void | Promise<void>;
};

/**
 * The only registration path for ordinary drawing-room events. Rate limiting
 * happens before parsing so malformed traffic consumes the same budget, and
 * the feature handler cannot run until fresh room access has been checked.
 */
export const registerAuthorizedRoomEvent = <Payload extends RoomEventPayload>({
  socket,
  event,
  limit,
  windowMs,
  parse,
  requireAccess,
  requireEdit = false,
  handle,
}: RegisterAuthorizedRoomEventOptions<Payload>): void => {
  const allow = createRateLimiter(limit, windowMs);
  socket.on(event, async (value: unknown) => {
    if (!allow()) return;
    const payload = parse(value);
    if (!payload || !(await requireAccess(socket, payload.drawingId, requireEdit))) return;
    await handle(payload);
  });
};
