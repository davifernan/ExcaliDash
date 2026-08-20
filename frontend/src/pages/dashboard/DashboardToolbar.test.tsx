import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { DashboardToolbar } from "./DashboardToolbar";

describe("DashboardToolbar async actions", () => {
  it("disables and relabels New Drawing while creation is pending", async () => {
    let resolveCreate!: () => void;
    const onCreateDrawing = vi.fn(() => new Promise<void>((resolve) => (resolveCreate = resolve)));

    render(
      <DashboardToolbar
        search=""
        searchInputRef={createRef<HTMLInputElement>()}
        sortConfig={{ field: "updatedAt", direction: "desc" }}
        sortOptions={[{ field: "updatedAt", label: "Date Modified", icon: null }]}
        currentSortOption={{ field: "updatedAt", label: "Date Modified", icon: null }}
        showSortMenu={false}
        sortedDrawingsCount={0}
        allSelected={false}
        hasSelection={false}
        isTrashView={false}
        isSharedView={false}
        isSharedCollection={false}
        showBulkMoveMenu={false}
        selectedCount={0}
        collections={[]}
        onSearchChange={vi.fn()}
        onShowSortMenuChange={vi.fn()}
        onSortFieldChange={vi.fn()}
        onSortDirectionToggle={vi.fn()}
        onSelectAll={vi.fn()}
        onBulkDeleteClick={vi.fn()}
        onBulkDuplicate={vi.fn()}
        onShowBulkMoveMenuChange={vi.fn()}
        onBulkMove={vi.fn()}
        onImportDrawings={vi.fn()}
        onCreateDrawing={onCreateDrawing}
        onViewerActionError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New Drawing" }));

    const pendingButton = screen.getByRole("button", { name: "Creating..." });
    expect(pendingButton).toBeDisabled();
    expect(onCreateDrawing).toHaveBeenCalledTimes(1);

    resolveCreate();
    await waitFor(() => expect(screen.getByRole("button", { name: "New Drawing" })).toBeEnabled());
  });
});
