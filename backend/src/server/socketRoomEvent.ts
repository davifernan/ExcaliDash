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
   * A budget that outlives this socket, checked in addition to the
   * per-connection one rather than instead of it.
   *
   * The per-connection limiter is fine for anything a client only gains by
   * doing quickly. It is not fine where opening a second tab hands out a second
   * budget: there the caller passes a limiter keyed by account or address, so
   * reconnecting -- or connecting fifty times -- buys nothing. Both apply,
   * because a shared budget large enough for several tabs would otherwise let
   * a single tab spend all of it.
   */
  allow?: () => boolean;
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
  handle,
}: RegisterAuthorizedRoomEventOptions<Payload>): void => {
  const allowThisConnection = createRateLimiter(limit, windowMs);
  const allow = () => allowThisConnection() && (sharedAllow?.() ?? true);
  let tail: Promise<void> = Promise.resolve();
  socket.on(event, (value: unknown) => {
    // Rate limiting stays synchronous and outside the queue: refusing traffic
    // is the one thing that must not wait behind the traffic it is refusing.
    if (!allow()) return;
    tail = tail.then(async () => {
      const payload = parse(value);
      if (!payload || !(await requireAccess(socket, payload.drawingId, requireEdit))) return;
      await handle(payload);
    });
    // A thrown handler must not poison the tail for everything after it.
    tail = tail.catch(() => {});
    // Socket.IO ignores what a listener returns; tests await it, which is the
    // only way they can observe work that is now deliberately deferred.
    return tail;
  });
};
