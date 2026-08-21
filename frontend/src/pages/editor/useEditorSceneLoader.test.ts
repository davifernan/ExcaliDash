import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MutableRefObject } from "react";
import { useEditorSceneLoader } from "./useEditorSceneLoader";
import * as api from "../../api";

vi.mock("../../api", () => ({
  getDrawing: vi.fn(),
  getLibrary: vi.fn(async () => []),
  isAxiosError: () => false,
  API_URL: "",
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const ref = <T>(value: T) => ({ current: value }) as MutableRefObject<T>;

const buildRefs = () => ({
  elementVersionMap: ref(new Map<string, any>()),
  saveQueue: ref(Promise.resolve()),
  latestElements: ref([] as readonly any[]),
  initialSceneElements: ref([] as readonly any[]),
  latestFiles: ref<any>({}),
  lastSyncedFiles: ref<Record<string, any>>({}),
  lastSyncedElementOrderSig: ref(""),
  lastPersistedFiles: ref<Record<string, any>>({}),
  currentDrawingVersion: ref<number | null>(null),
  lastPersistedElements: ref([] as readonly any[]),
  suspiciousBlankLoad: ref(false),
  hasSceneChangesSinceLoad: ref(false),
  excalidrawAPI: ref<any>(null),
  latestAppState: ref<any>(null),
  isBootstrappingScene: ref(false),
  hasHydratedInitialScene: ref(false),
});

const loadScene = async (id: string | undefined) => {
  const setInitialData = vi.fn();
  renderHook(() =>
    useEditorSceneLoader({
      id,
      user: null,
      location: { pathname: `/editor/${id ?? ""}`, search: "", hash: "" },
      navigate: vi.fn() as any,
      refs: buildRefs(),
      setAccessLevel: vi.fn(),
      setDrawingName: vi.fn(),
      setInitialData,
      setIsReady: vi.fn(),
      setIsSceneLoading: vi.fn(),
      setLoadError: vi.fn(),
      recordElementVersion: vi.fn(),
    }),
  );
  await waitFor(() => expect(setInitialData).toHaveBeenCalledWith(expect.objectContaining({})));
  return setInitialData.mock.calls.at(-1)?.[0]?.appState;
};

const storedDrawing = (appState: Record<string, any>) => ({
  name: "Board",
  accessLevel: "owner",
  elements: [],
  files: {},
  appState,
  version: 1,
});

describe("the appState a board opens with", () => {
  beforeEach(() => {
    vi.mocked(api.getDrawing).mockReset();
  });

  it("switches object snapping on for a scratch board", async () => {
    expect((await loadScene(undefined)).objectsSnapModeEnabled).toBe(true);
  });

  it("switches object snapping on for a board that predates the setting", async () => {
    vi.mocked(api.getDrawing).mockResolvedValue(storedDrawing({ viewBackgroundColor: "#fff" }));
    expect((await loadScene("abc")).objectsSnapModeEnabled).toBe(true);
  });

  it("leaves the grid alone on a board that draws on it", async () => {
    vi.mocked(api.getDrawing).mockResolvedValue(storedDrawing({ gridModeEnabled: true }));
    const appState = await loadScene("abc");
    expect(appState.objectsSnapModeEnabled).toBe(false);
    expect(appState.gridModeEnabled).toBe(true);
  });

  it("honours a board where snapping was switched off on purpose", async () => {
    vi.mocked(api.getDrawing).mockResolvedValue(storedDrawing({ objectsSnapModeEnabled: false }));
    expect((await loadScene("abc")).objectsSnapModeEnabled).toBe(false);
  });
});
