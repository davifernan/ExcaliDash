import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { HistoryPanel } from "./HistoryPanel";

vi.mock("../api", () => ({
  getDrawingHistory: vi.fn(),
  getDrawingSnapshot: vi.fn(),
  restoreDrawingSnapshot: vi.fn(),
}));

describe("HistoryPanel", () => {
  const getHistory = vi.mocked(api.getDrawingHistory);
  const getSnapshot = vi.mocked(api.getDrawingSnapshot);
  const restoreSnapshot = vi.mocked(api.restoreDrawingSnapshot);

  beforeEach(() => vi.clearAllMocks());

  it("shows an actionable load error instead of an empty-history message", async () => {
    getHistory.mockRejectedValue(new Error("offline"));

    render(
      <HistoryPanel
        drawingId="drawing-1"
        isOpen
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onPreview={vi.fn()}
      />,
    );

    expect(await screen.findByText(/version history couldn't be loaded/i)).toBeVisible();
    expect(screen.queryByText("No history yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(getHistory).toHaveBeenCalledTimes(2));
  });

  it("shows a restore error and lets the user retry", async () => {
    getHistory.mockResolvedValue({
      snapshots: [{ id: "snapshot-1", version: 7, createdAt: new Date().toISOString() }],
      totalCount: 1,
    });
    getSnapshot.mockResolvedValue({
      id: "snapshot-1",
      drawingId: "drawing-1",
      version: 7,
      createdAt: new Date().toISOString(),
      elements: [],
      appState: {},
      files: {},
    });
    restoreSnapshot.mockRejectedValue(new Error("restore failed"));

    render(
      <HistoryPanel
        drawingId="drawing-1"
        isOpen
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onPreview={vi.fn()}
      />,
    );

    const restore = await screen.findByRole("button", { name: "Restore version 7" });
    fireEvent.click(restore);
    fireEvent.click(screen.getByRole("button", { name: /confirm restore/i }));

    expect(await screen.findByText(/couldn't restore version 7/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Restore version 7" })).toBeEnabled();
  });
});
