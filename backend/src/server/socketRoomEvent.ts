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
  /**
   * A budget that outlives this socket.
   *
   * The default limiter is per-connection, which is fine for anything a client
   * only gains by doing quickly. It is not fine where reconnecting would reset
   * the budget: there the caller passes a shared limiter keyed by account or
   * address, so dropping and redialling buys nothing.
   */
  allow?: () => boolean;
  /** Payload-aware budget, evaluated after validation but before access I/O. */
  allowPayload?: (payload: Payload) => boolean;
  /**
   * Told when a payload is refused on its own merits -- malformed, too large,
   * over budget. Deliberately not called for a failed access check: that answer
   * belongs to the authorisation path, and saying more would describe the board
   * to somebody who is not allowed to see it.
   *
   * Without this a refusal is silent, and the sender goes on drawing while
   * nobody else sees any of it.
   */
  onRefused?: () => void;
  handle: (payload: Payload) => void | Promise<void>;
};

/**
 * The only registration path for ordinary drawing-room events. Rate limiting
 * happens before parsing so malformed traffic consumes the same budget, and
 * the feature handler cannot run until fresh room access has been checked.
 *
 * Handlers for one event on one socket run strictly in arrival order. The
 * access check is a database round trip, so two messages sent a millisecond
 * apart can finish theirs in either order -- and the consequences are not
 * cosmetic: the "stop talking" that follows a chat message could be applied
 * first, leaving a bubble on everyone's screen with no way to clear it, and an
 * older selection could land after a newer one. Each registration therefore
 * keeps its own tail and appends to it, which costs one promise per message and
 * makes the order the sender's rather than the database's.
 */
export const registerAuthorizedRoomEvent = <Payload extends RoomEventPayload>({
  socket,
  event,
  limit,
  windowMs,
  parse,
  requireAccess,
  requireEdit = false,
  allow: sharedAllow,
  allowPayload,
  onRefused,
  handle,
}: RegisterAuthorizedRoomEventOptions<Payload>): void => {
  const allow = sharedAllow ?? createRateLimiter(limit, windowMs);
  let tail: Promise<void> = Promise.resolve();
  socket.on(event, (value: unknown) => {
    // Rate limiting stays synchronous and outside the queue: refusing traffic
    // is the one thing that must not wait behind the traffic it is refusing.
    if (!allow()) return;
    tail = tail.then(async () => {
      const payload = parse(value);
      if (!payload || (allowPayload && !allowPayload(payload))) {
        onRefused?.();
        return;
      }
      if (!(await requireAccess(socket, payload.drawingId, requireEdit))) return;
      await handle(payload);
    });
    // A thrown handler must not poison the tail for everything after it.
    tail = tail.catch(() => {});
    // Socket.IO ignores what a listener returns; tests await it, which is the
    // only way they can observe work that is now deliberately deferred.
    return tail;
  });
};
