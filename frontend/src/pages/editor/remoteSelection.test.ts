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
      selectedElementIds: { a: true, b: true },
    });

    const collaborators = api.updateScene.mock.calls[0][0].collaborators;
    expect(collaborators.get("peer")).toEqual({
      ...collaborator,
      selectedElementIds: { a: true, b: true },
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

  it("caps outgoing ids and omits overlong ids", () => {
    const socket = new FakeSocket();
    const binding = bindRemoteSelection({
      socket: socket as any,
      drawingId: "drawing-1",
      api: { getAppState: () => ({}), updateScene: vi.fn() },
      throttleMs: 0,
    });
    const selectedElementIds = Object.fromEntries(
      Array.from({ length: REMOTE_SELECTION_LIMITS.ids + 1 }, (_, index) => [`id-${index}`, true]),
    );
    selectedElementIds["x".repeat(REMOTE_SELECTION_LIMITS.idLength + 1)] = true;

    binding.publish({ selectedElementIds });

    expect(socket.emit.mock.calls[0][1].selectedElementIds).toHaveLength(
      REMOTE_SELECTION_LIMITS.ids,
    );
    expect(socket.emit.mock.calls[0][1].selectedElementIds).not.toContain(
      "x".repeat(REMOTE_SELECTION_LIMITS.idLength + 1),
    );
  });
});
