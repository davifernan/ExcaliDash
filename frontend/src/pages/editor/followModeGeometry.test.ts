import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ filter: "none" })) as any;
});

import { getVisibleSceneBounds, sceneCoordsToViewportCoords } from "@excalidraw/excalidraw";
import { fitFollowedBounds } from "./followMode";

const appState = (width: number, height: number) => ({
  width,
  height,
  offsetLeft: 0,
  offsetTop: 0,
  scrollX: 0,
  scrollY: 0,
  zoom: { value: 1 },
});

describe("follow viewport geometry with Excalidraw", () => {
  it.each([
    { width: 1_600, height: 520 },
    { width: 760, height: 900 },
  ])("keeps the target viewport identical inside a $width x $height follower", ({ width, height }) => {
    const targetBounds = [120, -80, 880, 820] as const;
    let state: any = appState(width, height);
    const api = {
      getAppState: () => state,
      updateScene: vi.fn(({ appState: update }: any) => {
        state = { ...state, ...update };
      }),
    };

    const fitted = fitFollowedBounds(api, targetBounds as any);
    const visible = getVisibleSceneBounds(fitted.appState);

    expect(visible[0]).toBeLessThanOrEqual(targetBounds[0]);
    expect(visible[1]).toBeLessThanOrEqual(targetBounds[1]);
    expect(visible[2]).toBeGreaterThanOrEqual(targetBounds[2]);
    expect(visible[3]).toBeGreaterThanOrEqual(targetBounds[3]);

    const topLeft = sceneCoordsToViewportCoords(
      { sceneX: targetBounds[0], sceneY: targetBounds[1] },
      fitted.appState,
    );
    const bottomRight = sceneCoordsToViewportCoords(
      { sceneX: targetBounds[2], sceneY: targetBounds[3] },
      fitted.appState,
    );
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(width);
    expect(bottomRight.y).toBeLessThanOrEqual(height);
  });
});
