import { beforeEach, describe, expect, it, vi } from "vitest";

const excalidrawMocks = vi.hoisted(() => ({
  getVisibleSceneBounds: vi.fn(() => [-50, -25, 450, 275]),
  zoomToFitBounds: vi.fn(() => ({
    appState: { scrollX: 0, scrollY: 100, zoom: { value: 2 } },
  })),
}));

vi.mock("@excalidraw/excalidraw", () => ({
  getVisibleSceneBounds: excalidrawMocks.getVisibleSceneBounds,
  zoomToFitBounds: excalidrawMocks.zoomToFitBounds,
}));

import {
  bindFollowMode,
  fitFollowedBounds,
  parseFollowSceneBounds,
} from "./followMode";

describe("follow viewport bounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts only finite, ordered scene rectangles", () => {
    expect(parseFollowSceneBounds([-10, -20, 300, 400])).toEqual([
      -10,
      -20,
      300,
      400,
    ]);
    expect(parseFollowSceneBounds([0, 0, Number.NaN, 10])).toBeNull();
    expect(parseFollowSceneBounds([0, 0, 0, 10])).toBeNull();
    expect(parseFollowSceneBounds([0, 0, 10])).toBeNull();
  });

  it("uses Excalidraw's viewport fit for different window dimensions", () => {
    const updateScene = vi.fn();
    const api = {
      getAppState: () => ({
        width: 800,
        height: 800,
        scrollX: 100,
        scrollY: 100,
        zoom: { value: 1 },
      }),
      updateScene,
    };

    fitFollowedBounds(api, [0, 0, 400, 200] as any);

    expect(excalidrawMocks.zoomToFitBounds).toHaveBeenCalledWith({
      appState: api.getAppState(),
      bounds: [0, 0, 400, 200],
      fitToViewport: true,
      viewportZoomFactor: 1,
    });
    expect(updateScene).toHaveBeenCalledOnce();
    expect(updateScene.mock.calls[0][0].appState.zoom.value).toBe(2);
    expect(updateScene.mock.calls[0][0].appState.scrollX).toBe(0);
    expect(updateScene.mock.calls[0][0].appState.scrollY).toBe(100);
  });

  it("binds the imperative follow API and relays bounds only for followers", () => {
    vi.useFakeTimers();
    const handlers = new Map<string, (payload: any) => void>();
    const socket = {
      emit: vi.fn(),
      on: vi.fn((event: string, handler: (payload: any) => void) => {
        handlers.set(event, handler);
      }),
      off: vi.fn(),
    };
    let followCallback: (payload: any) => void = () => undefined;
    let scrollCallback: () => void = () => undefined;
    const state: any = {
      width: 1000,
      height: 600,
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 },
      userToFollow: { socketId: "target-socket" },
      followedBy: new Set(),
    };
    const api = {
      getAppState: () => state,
      updateScene: vi.fn(),
      onUserFollow: vi.fn((callback: (payload: any) => void) => {
        followCallback = callback;
        return vi.fn();
      }),
      onScrollChange: vi.fn((callback: () => void) => {
        scrollCallback = callback;
        return vi.fn();
      }),
    };
    const onFollowersChange = vi.fn();
    const cleanup = bindFollowMode({
      socket: socket as any,
      drawingId: "drawing-1",
      api,
      container: null,
      onFollowersChange,
    });

    followCallback({
      action: "FOLLOW",
      userToFollow: { socketId: "target-socket" },
    });
    expect(socket.emit).toHaveBeenCalledWith("follow-user", {
      drawingId: "drawing-1",
      targetPresenceId: "target-socket",
      action: "FOLLOW",
    });

    scrollCallback();
    vi.advanceTimersByTime(50);
    expect(socket.emit).toHaveBeenCalledTimes(1);

    handlers.get("followed-by-update")?.({
      drawingId: "drawing-1",
      followers: [{ presenceId: "follower-socket", name: "Follower" }],
    });
    expect(onFollowersChange).toHaveBeenCalledWith([
      { presenceId: "follower-socket", name: "Follower" },
    ]);
    expect(socket.emit).toHaveBeenLastCalledWith("viewport-bounds", {
      drawingId: "drawing-1",
      sceneBounds: [-50, -25, 450, 275],
    });

    scrollCallback();
    vi.advanceTimersByTime(50);
    expect(socket.emit).toHaveBeenLastCalledWith("viewport-bounds", {
      drawingId: "drawing-1",
      sceneBounds: [-50, -25, 450, 275],
    });

    cleanup();
    vi.useRealTimers();
  });
});
