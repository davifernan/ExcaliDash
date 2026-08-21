import { describe, expect, it, vi } from "vitest";
import {
  bindCursorChat,
  CURSOR_CHAT_EVENT,
  CURSOR_CHAT_MAX_LENGTH,
  shouldOpenCursorChat,
  withCursorChat,
} from "./cursorChat";

describe("which keystrokes open cursor chat", () => {
  it("takes a bare slash", () => {
    expect(shouldOpenCursorChat({ key: "/" })).toBe(true);
  });

  it("leaves the slash alone while somebody is writing", () => {
    // Without this you cannot type a slash into a sticky note, which is a worse
    // bug than not having cursor chat at all.
    expect(shouldOpenCursorChat({ key: "/", target: { tagName: "TEXTAREA" } })).toBe(false);
    expect(shouldOpenCursorChat({ key: "/", target: { tagName: "input" } })).toBe(false);
    expect(shouldOpenCursorChat({ key: "/", target: { isContentEditable: true } })).toBe(false);
  });

  it("ignores modified slashes, which belong to the browser", () => {
    expect(shouldOpenCursorChat({ key: "/", ctrlKey: true })).toBe(false);
    expect(shouldOpenCursorChat({ key: "/", metaKey: true })).toBe(false);
  });

  it("ignores every other key", () => {
    expect(shouldOpenCursorChat({ key: "n" })).toBe(false);
  });
});

describe("what a cursor label says", () => {
  it("is just the name when nobody is speaking", () => {
    expect(withCursorChat("Davi", undefined)).toBe("Davi");
  });

  it("keeps the name in front, so you can tell who is talking", () => {
    expect(withCursorChat("Davi", "over here")).toBe("Davi: over here");
  });
});

describe("the cursor chat controller", () => {
  const makeSocket = () => {
    const handlers = new Map<string, (payload: any) => void>();
    const sent: any[] = [];
    return {
      handlers,
      sent,
      socket: {
        emit: (event: string, payload: unknown) => sent.push({ event, payload }),
        on: (event: string, handler: any) => handlers.set(event, handler),
        off: (event: string) => handlers.delete(event),
      },
    };
  };

  it("says nothing until the composer is open", () => {
    const { socket, sent } = makeSocket();
    const chat = bindCursorChat({
      socket,
      drawingId: "board",
      onRemoteChange: () => {},
      onDraftChange: () => {},
    });
    chat.type("ignored");
    expect(sent).toHaveLength(0);
  });

  it("sends what is typed and clears on close", () => {
    const { socket, sent } = makeSocket();
    const drafts: (string | null)[] = [];
    const chat = bindCursorChat({
      socket,
      drawingId: "board",
      onRemoteChange: () => {},
      onDraftChange: (draft) => drafts.push(draft),
    });
    chat.open();
    chat.type("over here");
    expect(sent.at(-1)).toEqual({
      event: CURSOR_CHAT_EVENT,
      payload: { drawingId: "board", text: "over here" },
    });
    chat.close();
    // Closing has to reach everyone else, or the bubble hangs on their screen.
    expect(sent.at(-1)).toEqual({
      event: CURSOR_CHAT_EVENT,
      payload: { drawingId: "board", text: null },
    });
    expect(drafts).toEqual(["", "over here", null]);
  });

  it("delivers the end of a fast sentence rather than dropping it", () => {
    // The server allows ten of these a second. Typing a sentence produces far
    // more keystrokes than that, and the ones it drops are the last ones -- so
    // an unthrottled client leaves the reader looking at half a thought.
    vi.useFakeTimers();
    try {
      const { socket, sent } = makeSocket();
      const chat = bindCursorChat({
        socket,
        drawingId: "board",
        onRemoteChange: () => {},
        onDraftChange: () => {},
      });
      chat.open();
      const sentence = "does this work for everyone";
      for (let i = 1; i <= sentence.length; i += 1) {
        chat.type(sentence.slice(0, i));
        vi.advanceTimersByTime(5);
      }
      vi.advanceTimersByTime(500);
      expect(sent.at(-1).payload.text).toBe(sentence);
      expect(sent.length).toBeLessThan(sentence.length);
    } finally {
      vi.useRealTimers();
    }
  });

  it("will not send more than the cap even if asked to", () => {
    const { socket, sent } = makeSocket();
    const chat = bindCursorChat({
      socket,
      drawingId: "board",
      onRemoteChange: () => {},
      onDraftChange: () => {},
    });
    chat.open();
    chat.type("x".repeat(CURSOR_CHAT_MAX_LENGTH + 50));
    expect(sent.at(-1).payload.text).toHaveLength(CURSOR_CHAT_MAX_LENGTH);
  });

  it("remembers what others say and forgets it when they stop", () => {
    const { socket, handlers } = makeSocket();
    const onRemoteChange = vi.fn();
    const chat = bindCursorChat({
      socket,
      drawingId: "board",
      onRemoteChange,
      onDraftChange: () => {},
    });
    handlers.get(CURSOR_CHAT_EVENT)!({ presenceId: "p1", text: "hello" });
    expect(chat.remote.get("p1")).toBe("hello");
    handlers.get(CURSOR_CHAT_EVENT)!({ presenceId: "p1", text: null });
    expect(chat.remote.has("p1")).toBe(false);
    expect(onRemoteChange).toHaveBeenCalledTimes(2);
  });

  it("drops messages that do not name a sender", () => {
    const { socket, handlers } = makeSocket();
    const chat = bindCursorChat({
      socket,
      drawingId: "board",
      onRemoteChange: () => {},
      onDraftChange: () => {},
    });
    handlers.get(CURSOR_CHAT_EVENT)!({ text: "who said that" });
    expect(chat.remote.size).toBe(0);
  });
});
