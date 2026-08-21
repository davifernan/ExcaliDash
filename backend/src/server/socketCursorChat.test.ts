import { describe, expect, it, vi } from "vitest";
import {
  CURSOR_CHAT_EVENT,
  CURSOR_CHAT_LIMITS,
  parseCursorChatPayload,
  registerCursorChatRoomEvent,
} from "./socketCursorChat";

describe("cursor chat payloads", () => {
  const drawingId = "11111111-2222-3333-4444-555555555555";

  it("accepts a sentence and clears on null", () => {
    expect(parseCursorChatPayload({ drawingId, text: "over here" })).toEqual({
      drawingId,
      text: "over here",
    });
    expect(parseCursorChatPayload({ drawingId, text: null })).toEqual({ drawingId, text: null });
  });

  it("refuses anything longer than the cap", () => {
    const tooLong = "x".repeat(CURSOR_CHAT_LIMITS.textLength + 1);
    expect(parseCursorChatPayload({ drawingId, text: tooLong })).toBeNull();
    expect(
      parseCursorChatPayload({ drawingId, text: "x".repeat(CURSOR_CHAT_LIMITS.textLength) }),
    ).not.toBeNull();
  });

  it("flattens control characters instead of passing them on", () => {
    // A newline would let a sender break out of the single line the bubble
    // occupies beside someone's cursor.
    expect(parseCursorChatPayload({ drawingId, text: "one\ntwo" })).toEqual({
      drawingId,
      text: "one two",
    });
  });

  it("treats whitespace-only as nothing to say", () => {
    expect(parseCursorChatPayload({ drawingId, text: "   " })).toEqual({ drawingId, text: null });
  });

  it("keeps nothing from the payload but the board and the words", () => {
    // Defence in depth for the handler, which stamps the sender from the
    // socket. Asserting it here too means either half can regress on its own
    // and still be caught, rather than only both together.
    expect(parseCursorChatPayload({ drawingId, text: "hi", presenceId: "somebody-else" })).toEqual({
      drawingId,
      text: "hi",
    });
  });

  it("refuses payloads that are not shaped like a message", () => {
    expect(parseCursorChatPayload({ drawingId, text: 42 })).toBeNull();
    expect(parseCursorChatPayload({ text: "no board" })).toBeNull();
    expect(parseCursorChatPayload(null)).toBeNull();
  });
});

describe("cursor chat over the socket", () => {
  const drawingId = "11111111-2222-3333-4444-555555555555";

  const setup = (allowed = true, allow?: () => boolean) => {
    const handlers = new Map<string, (value: unknown) => Promise<void> | void>();
    const emitted: { event: string; payload: any }[] = [];
    const to = () => ({
      emit: (event: string, payload: any) => emitted.push({ event, payload }),
    });
    const socket = {
      id: "socket-1",
      on: (event: string, handler: any) => handlers.set(event, handler),
      volatile: { to },
      to,
    } as any;
    const requireAccess = vi.fn(async () => allowed);
    registerCursorChatRoomEvent({ socket, requireAccess, allow });
    return { handlers, emitted, requireAccess };
  };

  it("stamps the sender from the socket, never from the payload", async () => {
    const { handlers, emitted } = setup();
    await handlers.get(CURSOR_CHAT_EVENT)!({
      drawingId,
      text: "here",
      presenceId: "somebody-else",
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload.presenceId).toBe("socket-1");
  });

  it("says nothing when the room refuses the sender", async () => {
    const { handlers, emitted } = setup(false);
    await handlers.get(CURSOR_CHAT_EVENT)!({ drawingId, text: "here" });
    expect(emitted).toHaveLength(0);
  });

  it("stops relaying text at the rate limit but always relays a clear", async () => {
    let typingBudget = CURSOR_CHAT_LIMITS.eventsPerSecond;
    const { handlers, emitted } = setup(true, () => {
      typingBudget -= 1;
      return typingBudget >= 0;
    });
    const send = handlers.get(CURSOR_CHAT_EVENT)!;
    for (let i = 0; i < CURSOR_CHAT_LIMITS.eventsPerSecond + 5; i += 1) {
      await send({ drawingId, text: `message ${i}` });
    }
    expect(emitted.length).toBe(CURSOR_CHAT_LIMITS.eventsPerSecond);
    await send({ drawingId, text: null });
    expect(emitted).toHaveLength(CURSOR_CHAT_LIMITS.eventsPerSecond + 1);
    expect(emitted.at(-1)?.payload.text).toBeNull();
    await send({ drawingId, text: null });
    expect(emitted).toHaveLength(CURSOR_CHAT_LIMITS.eventsPerSecond + 1);
  });
  it("relays in the order sent even when the access checks finish backwards", async () => {
    // The access check is a database round trip. Two messages a millisecond
    // apart can finish theirs in either order, and the consequence is not
    // cosmetic: if the clearing null overtakes the last words, a bubble stays
    // on everyone's screen with nothing left to remove it.
    const handlers = new Map<string, (value: unknown) => Promise<void> | void>();
    const emitted: any[] = [];
    const to = () => ({ emit: (_event: string, payload: any) => emitted.push(payload) });
    const socket = {
      id: "socket-1",
      on: (event: string, handler: any) => handlers.set(event, handler),
      volatile: { to },
      to,
    } as any;

    let call = 0;
    const requireAccess = vi.fn(async () => {
      call += 1;
      // The first check is the slow one.
      const delay = call === 1 ? 20 : 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return true;
    });
    registerCursorChatRoomEvent({ socket, requireAccess });
    const send = handlers.get(CURSOR_CHAT_EVENT)!;

    const first = send({ drawingId, text: "the whole sentence" });
    const second = send({ drawingId, text: null });
    await Promise.all([first, second]);

    expect(emitted.map((payload) => payload.text)).toEqual(["the whole sentence", null]);
  });
});
