import { afterEach, describe, expect, it, vi } from "vitest";
import { bindRemoteSelection, REMOTE_SELECTION_LIMITS } from "./remoteSelection";

class FakeSocket {
  private handlers = new Map<string, (payload: any) => void>();
  emit = vi.fn();

  on(event: string, handler: (payload: any) => void) {
    this.handlers.set(event, handler);
  }

  off(event: string, handler: (payload: any) => void) {
    if (this.handlers.get(event) === handler) this.handlers.delete(event);
  }

  trigger(event: string, payload: any) {
    this.handlers.get(event)?.(payload);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("remote selection binding", () => {
  it("merges selected ids into the existing collaborator", () => {
    const socket = new FakeSocket();
    const collaborator = { id: "peer", username: "Nilo" };
    const api = {
      getAppState: () => ({ collaborators: new Map([["peer", collaborator]]) }),
      updateScene: vi.fn(),
    };
    bindRemoteSelection({ socket: socket as any, drawingId: "drawing-1", api });

    socket.trigger("selection-update", {
      drawingId: "drawing-1",
      presenceId: "peer",
      selectedElementIds: ["a", "b"],
    });

    const collaborators = api.updateScene.mock.calls[0][0].collaborators;
    expect(collaborators.get("peer")).toEqual({
      ...collaborator,
      selectedElementIds: { a: true, b: true },
    });
  });

  it("applies a private join snapshot in wire order", () => {
    const socket = new FakeSocket();
    let collaborators = new Map<string, any>();
    const api = {
      getAppState: () => ({ collaborators }),
      updateScene: vi.fn((scene: any) => {
        collaborators = scene.collaborators;
      }),
    };
    bindRemoteSelection({ socket: socket as any, drawingId: "drawing-1", api });

    socket.trigger("selection-snapshot", {
      drawingId: "drawing-1",
      selections: [{ presenceId: "peer", selectedElementIds: ["before"] }],
    });
    socket.trigger("selection-update", {
      drawingId: "drawing-1",
      presenceId: "peer",
      selectedElementIds: ["after"],
    });

    expect(collaborators.get("peer")?.selectedElementIds).toEqual({ after: true });
  });

  it("renders an all-selected marker as a large-selection status without guessed ids", () => {
    const socket = new FakeSocket();
    const collaborator = {
      id: "peer",
      username: "Nilo",
      selectedElementIds: { stale: true },
    };
    const api = {
      getAppState: () => ({ collaborators: new Map([["peer", collaborator]]) }),
      updateScene: vi.fn(),
    };
    bindRemoteSelection({ socket: socket as any, drawingId: "drawing-1", api });

    socket.trigger("selection-update", {
      drawingId: "drawing-1",
      presenceId: "peer",
      allSelected: true,
    });

    const rendered = api.updateScene.mock.calls[0][0].collaborators.get("peer");
    expect(rendered).toMatchObject({
      username: "Nilo · large selection",
      selectionAllSelected: true,
      selectedElementIds: {},
    });
  });

  it("sends a leading update and the final throttled selection", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const socket = new FakeSocket();
    const binding = bindRemoteSelection({
      socket: socket as any,
      drawingId: "drawing-1",
      api: { getAppState: () => ({}), updateScene: vi.fn() },
    });

    binding.publish({ selectedElementIds: { first: true } });
    vi.setSystemTime(1_010);
    binding.publish({ selectedElementIds: { second: true } });
    binding.publish({ selectedElementIds: { final: true } });
    expect(socket.emit).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(40);
    expect(socket.emit).toHaveBeenLastCalledWith("selection-update", {
      drawingId: "drawing-1",
      selectedElementIds: ["final"],
    });
  });

  it("budgets outgoing selections by encoded bytes instead of id count or character length", () => {
    const socket = new FakeSocket();
    const binding = bindRemoteSelection({
      socket: socket as any,
      drawingId: "drawing-1",
      api: { getAppState: () => ({}), updateScene: vi.fn() },
      throttleMs: 0,
    });
    const longId = "x".repeat(300);
    const selectedElementIds = Object.fromEntries([
      ...Array.from({ length: 300 }, (_, index) => [`id-${index}`, true] as const),
      [longId, true] as const,
    ]);

    binding.publish({ selectedElementIds });

    expect(socket.emit.mock.calls[0][1].selectedElementIds).toHaveLength(301);
    expect(socket.emit.mock.calls[0][1].selectedElementIds).toContain(longId);
    expect(
      new TextEncoder().encode(JSON.stringify(socket.emit.mock.calls[0][1])).byteLength,
    ).toBeLessThanOrEqual(REMOTE_SELECTION_LIMITS.payloadBytes);

    const oversizedSelection = Object.fromEntries(
      Array.from({ length: 30_000 }, (_, index) => [`element-${index}`, true]),
    );
    binding.publish({ selectedElementIds: oversizedSelection });
    expect(socket.emit).toHaveBeenLastCalledWith("selection-update", {
      drawingId: "drawing-1",
      allSelected: true,
    });
  });
});
