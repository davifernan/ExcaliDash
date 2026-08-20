import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetDashboardDataStatus,
  setDashboardDataStatus,
} from "./dashboardDataStatus";
import { DrawingsGrid } from "./DashboardPanels";

const baseProps = {
  drawings: [],
  collections: [],
  selectedIds: new Set<string>(),
  search: "",
  isLoading: false,
  isDraggingFile: false,
  isTrashView: false,
  isSharedView: false,
  isSharedCollection: false,
  onClearSearch: vi.fn(),
  onToggleSelection: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onDuplicate: vi.fn(),
  onMoveToCollection: vi.fn(),
  onOpenDrawing: vi.fn(),
  onMouseDown: vi.fn(),
  onDragStart: vi.fn(),
  onPreviewGenerated: vi.fn(),
};

describe("dashboard data failures", () => {
  afterEach(resetDashboardDataStatus);

  it("renders a retryable error instead of the empty state", () => {
    const retry = vi.fn();
    setDashboardDataStatus({
      drawingsError: "We couldn't load drawings. The server could not be reached. Check your connection and try again.",
      retryDrawings: retry,
    });

    render(<DrawingsGrid {...baseProps} />);

    expect(screen.getByRole("alert")).toHaveTextContent("couldn't load drawings");
    expect(screen.queryByText("No drawings found")).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
