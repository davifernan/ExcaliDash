import { describe, expect, it } from "vitest";
import {
  buildRemoteSceneUpdate,
  getPersistedAppState,
  hasRenderableElements,
  isSuspiciousEmptySnapshot,
  isStaleEmptySnapshot,
  isStaleNonRenderableSnapshot,
  resolveObjectsSnapMode,
  boardSettingsSignature,
  shouldSaveBoardSettings,
} from "./shared";

describe("editor/shared scene guards", () => {
  it("detects renderable elements", () => {
    expect(hasRenderableElements([{ id: "a", isDeleted: false }])).toBe(true);
    expect(
      hasRenderableElements([
        { id: "a", isDeleted: true },
        { id: "b", isDeleted: true },
      ]),
    ).toBe(false);
  });

  it("flags empty snapshot after a previously non-empty persisted scene", () => {
    const previous = [{ id: "a", isDeleted: false }];
    expect(isSuspiciousEmptySnapshot(previous, [])).toBe(true);
  });

  it("does not flag empty snapshot for already-empty drawings", () => {
    expect(isSuspiciousEmptySnapshot([], [])).toBe(false);
  });

  it("does not flag non-empty snapshots", () => {
    const previous = [{ id: "a", isDeleted: false }];
    const next = [{ id: "a", isDeleted: true }];
    expect(isSuspiciousEmptySnapshot(previous, next)).toBe(false);
  });

  it("flags stale empty snapshot when latest scene is non-empty", () => {
    const latest = [{ id: "a", version: 2, versionNonce: 2, isDeleted: false }];
    expect(isStaleEmptySnapshot(latest, [])).toBe(true);
  });

  it("does not flag empty snapshot when latest scene is already empty", () => {
    expect(isStaleEmptySnapshot([], [])).toBe(false);
  });

  it("does not flag identical empty snapshots", () => {
    const latest = [];
    const candidate = [];
    expect(isStaleEmptySnapshot(latest, candidate)).toBe(false);
  });

  it("flags stale non-renderable snapshot when latest scene has renderable elements", () => {
    const latest = [{ id: "a", version: 2, versionNonce: 2, isDeleted: false }];
    const candidate = [{ id: "a", version: 1, versionNonce: 1, isDeleted: true }];
    expect(isStaleNonRenderableSnapshot(latest, candidate)).toBe(true);
  });

  it("does not flag non-renderable snapshot when latest scene is already non-renderable", () => {
    const latest = [{ id: "a", version: 2, versionNonce: 2, isDeleted: true }];
    const candidate = [{ id: "a", version: 1, versionNonce: 1, isDeleted: true }];
    expect(isStaleNonRenderableSnapshot(latest, candidate)).toBe(false);
  });

  it("marks collaborator-only updates as non-history scene changes", () => {
    const collaborators = new Map([["user-2", { id: "user-2", username: "B" }]]);

    const result = buildRemoteSceneUpdate({ collaborators });

    expect(result.sceneUpdate).toEqual({
      collaborators,
      captureUpdate: "NEVER",
    });
    expect(result.mergedElements).toBeNull();
    expect(result.shouldUpdateFiles).toBe(false);
  });

  it("marks remote element merges as non-history scene changes", () => {
    const localElements = [
      { id: "local", version: 1, versionNonce: 1, updated: 1, x: 0, y: 0, isDeleted: false },
    ];
    const pendingElements = [
      { id: "remote", version: 2, versionNonce: 2, updated: 2, x: 10, y: 15, isDeleted: false },
    ];

    const result = buildRemoteSceneUpdate({
      localElements,
      pendingElements,
      lastSyncedFiles: {},
      incomingFiles: {},
    });

    expect(result.sceneUpdate).toEqual({
      elements: [localElements[0], pendingElements[0]],
      captureUpdate: "NEVER",
    });
    expect(result.mergedElements).toEqual([localElements[0], pendingElements[0]]);
  });

  it("marks remote file-only updates as non-history scene changes", () => {
    const incomingFiles = {
      "file-1": {
        id: "file-1",
        mimeType: "image/png",
        dataURL: "data:image/png;base64,abc123",
      },
    };

    const result = buildRemoteSceneUpdate({
      lastSyncedFiles: {},
      incomingFiles,
    });

    expect(result.sceneUpdate).toEqual({
      files: incomingFiles,
      captureUpdate: "NEVER",
    });
    expect(result.mergedElements).toBeNull();
    expect(result.nextFiles).toEqual(incomingFiles);
    expect(result.shouldUpdateFiles).toBe(true);
  });

  it("preserves remote element order while keeping the update out of local history", () => {
    const localElements = [
      { id: "a", version: 1, versionNonce: 1, updated: 1, isDeleted: false },
      { id: "b", version: 1, versionNonce: 1, updated: 1, isDeleted: false },
    ];

    const result = buildRemoteSceneUpdate({
      localElements,
      pendingElements: [],
      elementOrder: ["b", "a"],
    });

    expect(result.sceneUpdate).toEqual({
      elements: [localElements[1], localElements[0]],
      captureUpdate: "NEVER",
    });
    expect(result.mergedElements).toEqual([localElements[1], localElements[0]]);
  });

  it("keeps only durable appState fields for persisted drawings", () => {
    expect(
      getPersistedAppState({
        viewBackgroundColor: "#123456",
        gridSize: 24,
        gridStep: 5,
        gridModeEnabled: true,
        objectsSnapModeEnabled: false,
        cursorButton: "down",
        activeTool: { type: "hand", locked: false, lastActiveTool: null },
        selectedElementIds: { a: true },
        selectedGroupIds: { g1: true },
        editingElement: { id: "editing" },
        draggingElement: { id: "dragging" },
        scrollX: 120,
        scrollY: 240,
      }),
    ).toEqual({
      viewBackgroundColor: "#123456",
      gridSize: 24,
      gridStep: 5,
      gridModeEnabled: true,
      objectsSnapModeEnabled: false,
    });
  });

  it("falls back to safe defaults when persisted appState is missing or invalid", () => {
    expect(getPersistedAppState(undefined)).toEqual({
      viewBackgroundColor: "#ffffff",
      gridSize: null,
    });

    expect(getPersistedAppState(null)).toEqual({
      viewBackgroundColor: "#ffffff",
      gridSize: null,
    });
  });

  it("carries the object snapping choice through a save and back", () => {
    const snapping = getPersistedAppState({ gridModeEnabled: false, objectsSnapModeEnabled: true });
    expect(snapping.objectsSnapModeEnabled).toBe(true);
    expect(resolveObjectsSnapMode(snapping)).toBe(true);

    const switchedOff = getPersistedAppState({ objectsSnapModeEnabled: false });
    expect(switchedOff.objectsSnapModeEnabled).toBe(false);
    expect(resolveObjectsSnapMode(switchedOff)).toBe(false);
  });

  it("starts a drawing with snapping unless it is one that draws on the grid", () => {
    // Excalidraw's own toggles switch grid and snapping off for each other, so
    // a default of "always on" would take the grid away from grid users.
    expect(resolveObjectsSnapMode(getPersistedAppState({}))).toBe(true);
    expect(resolveObjectsSnapMode(getPersistedAppState(undefined))).toBe(true);
    expect(resolveObjectsSnapMode(getPersistedAppState({ gridModeEnabled: false }))).toBe(true);
    expect(resolveObjectsSnapMode(getPersistedAppState({ gridModeEnabled: true }))).toBe(false);
    expect(resolveObjectsSnapMode({ gridModeEnabled: true, objectsSnapModeEnabled: "yes" })).toBe(
      false,
    );
  });
});

describe("board settings that have to be saved on their own", () => {
  const live = (overrides: Record<string, any> = {}) => ({
    viewBackgroundColor: "#ffffff",
    gridSize: 20,
    gridStep: 5,
    gridModeEnabled: false,
    objectsSnapModeEnabled: true,
    ...overrides,
  });

  it("saves nothing before the scene has hydrated", () => {
    // Everything Excalidraw reports while the scene is being set up is the
    // board arriving, not somebody changing it.
    expect(shouldSaveBoardSettings(null, live())).toBe(false);
  });

  it("stays quiet while the settings are unchanged", () => {
    const baseline = boardSettingsSignature(live());
    expect(shouldSaveBoardSettings(baseline, live())).toBe(false);
  });

  it("notices snapping and the grid being switched", () => {
    const baseline = boardSettingsSignature(live());
    expect(shouldSaveBoardSettings(baseline, live({ objectsSnapModeEnabled: false }))).toBe(true);
    expect(shouldSaveBoardSettings(baseline, live({ gridModeEnabled: true }))).toBe(true);
    expect(shouldSaveBoardSettings(baseline, live({ viewBackgroundColor: "#111111" }))).toBe(true);
  });

  it("does not treat a stored board as a changed one", () => {
    // The trap this exists to prevent: a stored board carries no grid size,
    // Excalidraw always reports one. Seeded from the server, every board would
    // save itself the moment it opened -- bumping its version for everyone.
    const stored = getPersistedAppState({ objectsSnapModeEnabled: true });
    expect(stored.gridSize).toBeNull();
    expect(boardSettingsSignature(stored)).not.toBe(boardSettingsSignature(live()));
  });
});
