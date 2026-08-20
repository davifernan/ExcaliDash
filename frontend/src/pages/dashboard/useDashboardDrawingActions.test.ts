import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { DrawingSummary } from "../../types";
import { useDashboardDrawingActions } from "./useDashboardDrawingActions";

vi.mock("../../api", () => ({
  createDrawing: vi.fn(),
  updateDrawing: vi.fn(),
  deleteDrawing: vi.fn(),
  duplicateDrawing: vi.fn(),
}));

const drawings: DrawingSummary[] = [
  { id: "d1", name: "Roadmap", collectionId: null, createdAt: 1, updatedAt: 1, version: 1 },
  { id: "d2", name: "Incident notes", collectionId: null, createdAt: 1, updatedAt: 1, version: 1 },
];

const renderActions = (initialSelection = new Set<string>()) => {
  const refreshData = vi.fn();
  const rendered = renderHook(() => {
    const [currentDrawings, setDrawings] = useState(drawings);
    const [selectedIds, setSelectedIds] = useState(initialSelection);
    const [, setTotalCount] = useState(drawings.length);
    const actions = useDashboardDrawingActions({
      drawings: currentDrawings,
      setDrawings,
      collections: [],
      selectedCollectionId: undefined,
      selectedIds,
      setSelectedIds,
      setTotalCount,
      uploadFiles: vi.fn(),
      refreshData,
      navigate: vi.fn(),
    });
    return { actions, selectedIds };
  });
  return { ...rendered, refreshData };
};

describe("dashboard drawing action failures", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a named, actionable error when an optimistic rename is rolled back", async () => {
    vi.mocked(api.updateDrawing).mockRejectedValue(new Error("offline"));
    const { result, refreshData } = renderActions();

    await act(async () => {
      await result.current.actions.handleRenameDrawing("d1", "New roadmap");
    });

    expect(refreshData).toHaveBeenCalledTimes(1);
    expect(result.current.actions.viewerActionError).toContain("Roadmap");
    expect(result.current.actions.viewerActionError).toContain("original name was restored");
    expect(result.current.actions.viewerActionError).toContain("try again");
  });

  it("names failed drawings in a partial bulk action and keeps them selected", async () => {
    vi.mocked(api.duplicateDrawing).mockImplementation(async (id) => {
      if (id === "d2") throw new Error("offline");
      return {} as any;
    });
    const { result, refreshData } = renderActions(new Set(["d1", "d2"]));

    await act(async () => {
      await result.current.actions.handleBulkDuplicate();
    });

    expect(refreshData).toHaveBeenCalledTimes(1);
    expect(Array.from(result.current.selectedIds)).toEqual(["d2"]);
    expect(result.current.actions.viewerActionError).toContain("Duplicated 1 of 2");
    expect(result.current.actions.viewerActionError).toContain("Incident notes");
    expect(result.current.actions.viewerActionError).toContain("retry the selected drawings");
  });

  it("prevents duplicate drawing creation while the first request is pending", async () => {
    let resolveCreate!: (value: { id: string }) => void;
    vi.mocked(api.createDrawing).mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const { result } = renderActions();

    let firstRequest!: Promise<void>;
    act(() => {
      firstRequest = result.current.actions.handleCreateDrawing();
      void result.current.actions.handleCreateDrawing();
    });

    expect(api.createDrawing).toHaveBeenCalledTimes(1);
    expect(result.current.actions.isCreatingDrawing).toBe(true);

    await act(async () => {
      resolveCreate({ id: "created" });
      await firstRequest;
    });

    expect(result.current.actions.isCreatingDrawing).toBe(false);
  });
});
