import { describe, expect, it, vi } from "vitest";
import { bindSocketDocumentPages, parseDocumentPageUpdate } from "./documentPages";

describe("reading a page update from the server", () => {
  it("takes the pages of this board", () => {
    expect(
      parseDocumentPageUpdate(
        { drawingId: "board-1", pages: [{ elementId: "widget-1", assetId: "a", page: 4 }] },
        "board-1",
      ),
    ).toEqual({ "widget-1": 4 });
  });

  it("ignores an update meant for a different board", () => {
    expect(parseDocumentPageUpdate({ drawingId: "other", pages: [] }, "board-1")).toBeNull();
  });

  it("drops entries that make no sense and keeps the rest", () => {
    expect(
      parseDocumentPageUpdate(
        {
          drawingId: "board-1",
          pages: [
            { elementId: "good", page: 2 },
            { elementId: "", page: 3 },
            { elementId: "fractional", page: 1.5 },
            { elementId: "zero", page: 0 },
            { elementId: "text", page: "4" },
            null,
          ],
        },
        "board-1",
      ),
    ).toEqual({ good: 2 });
  });

  it.each([[null], ["board-1"], [[]], [{ drawingId: "board-1" }]])(
    "refuses malformed payload %#",
    (value) => {
      expect(parseDocumentPageUpdate(value, "board-1")).toBeNull();
    },
  );
});

const fakeSocket = () => {
  const handlers = new Map<string, (value: unknown) => void>();
  return {
    handlers,
    on: vi.fn((event: string, handler: (value: unknown) => void) => {
      handlers.set(event, handler);
    }),
    off: vi.fn((event: string) => handlers.delete(event)),
    emit: (event: string, value: unknown) => handlers.get(event)?.(value),
  };
};

describe("following the room's pages", () => {
  it("merges a single widget's turn into what is already known", () => {
    const socket = fakeSocket();
    let pages: Record<string, number> = {};
    const bound = bindSocketDocumentPages({
      socket: socket as any,
      drawingId: "board-1",
      onChange: (update) => {
        pages = update(pages);
      },
    });

    socket.emit("document-page-update", {
      drawingId: "board-1",
      pages: [
        { elementId: "a", page: 2 },
        { elementId: "b", page: 5 },
      ],
    });
    socket.emit("document-page-update", {
      drawingId: "board-1",
      pages: [{ elementId: "a", page: 3 }],
    });

    // The second update spoke only about "a", so "b" has to survive it.
    expect(pages).toEqual({ a: 3, b: 5 });

    bound.reset();
    expect(pages).toEqual({});
    bound.dispose();
    expect(socket.handlers.size).toBe(0);
  });
});
