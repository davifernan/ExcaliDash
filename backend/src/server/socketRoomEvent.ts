import type { Socket } from "socket.io";
import { createRateLimiter } from "./socketProtocol";

export type RoomEventPayload = { drawingId: string };
export type RoomEventError = { code: string; message: string };
export type RoomEventAck = (
  value: { ok: true; warning?: RoomEventError } | { ok: false; error: RoomEventError },
) => void;
export type RoomEventResult = { warning: RoomEventError } | void;

const ROOM_EVENT_FEEDBACK_EVENT = "room-event-error";
const HARD_FAILURE_LIMIT = 10;
const HARD_FAILURE_WINDOW_MS = 60_000;
const hardFailures = new WeakMap<Socket, { windowStartedAt: number; count: number }>();

const reportHardFailure = (
  socket: Socket,
  event: string,
  error: RoomEventError,
  ack?: RoomEventAck,
) => {
  if (ack) ack({ ok: false, error });
  else socket.emit(ROOM_EVENT_FEEDBACK_EVENT, { event, error });

  const now = Date.now();
  let failures = hardFailures.get(socket);
  if (!failures || now - failures.windowStartedAt >= HARD_FAILURE_WINDOW_MS) {
    failures = { windowStartedAt: now, count: 0 };
    hardFailures.set(socket, failures);
  }
  failures.count += 1;
  // A normal client cannot produce a stream of invalid packets. Closing the
  // connection bounds error traffic while every packet the server accepts is
  // still answered exactly once.
  if (failures.count >= HARD_FAILURE_LIMIT) socket.disconnect(true);
};

export const createRoomEventFeedback = (socket: Socket, event: string, windowMs: number) => {
  let nextRateLimitNoticeAt = 0;
  return {
    invalid(ack?: RoomEventAck) {
      reportHardFailure(
        socket,
        event,
        { code: "invalid-request", message: `Invalid ${event} payload` },
        ack,
      );
    },
    rateLimited() {
      const now = Date.now();
      if (now < nextRateLimitNoticeAt) return false;
      nextRateLimitNoticeAt = now + windowMs;
      socket.emit(ROOM_EVENT_FEEDBACK_EVENT, {
        event,
        error: { code: "rate-limited", message: `${event} rate limit exceeded` },
      });
      return true;
    },
    succeeded(ack?: RoomEventAck, warning?: RoomEventError) {
      if (warning) {
        if (ack) ack({ ok: true, warning });
        else socket.emit(ROOM_EVENT_FEEDBACK_EVENT, { event, error: warning });
        return;
      }
      ack?.({ ok: true });
    },
  };
};

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
  handle: (payload: Payload) => RoomEventResult | Promise<RoomEventResult>;
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
  const feedback = createRoomEventFeedback(socket, event, windowMs);
  let tail: Promise<void> = Promise.resolve();
  socket.on(event, (value: unknown, ack?: RoomEventAck) => {
    // Rate limiting stays synchronous and outside the queue: refusing traffic
    // is the one thing that must not wait behind the traffic it is refusing.
    if (!allow()) {
      feedback.rateLimited();
      return;
    }
    tail = tail.then(async () => {
      const payload = parse(value);
      if (!payload) {
        feedback.invalid(ack);
        return;
      }
      if (!(await requireAccess(socket, payload.drawingId, requireEdit))) return;
      const result = await handle(payload);
      feedback.succeeded(ack, result ? result.warning : undefined);
    });
    // A thrown handler must not poison the tail for everything after it.
    tail = tail.catch(() => {});
    // Socket.IO ignores what a listener returns; tests await it, which is the
    // only way they can observe work that is now deliberately deferred.
    return tail;
  });
};
