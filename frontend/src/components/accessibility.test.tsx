import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmModal } from "./ConfirmModal";
import { DrawingCard } from "./DrawingCard";

vi.mock("../api", () => ({
  isS3Enabled: vi.fn().mockResolvedValue(false),
  getDrawing: vi.fn(),
}));

vi.mock("./drawing-card/useDrawingPreview", () => ({
  useDrawingPreview: () => ({
    previewSvg: null,
    hasEmbeddedImages: false,
    buildExportDrawing: vi.fn(),
  }),
}));

const drawing = {
  id: "drawing-1",
  name: "Team plan",
  collectionId: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  version: 1,
  preview: null,
};

afterEach(() => vi.clearAllMocks());

describe("dashboard accessibility", () => {
  it("opens a drawing through a keyboard-operable control", () => {
    const onClick = vi.fn();
    render(
      <DrawingCard
        drawing={drawing}
        collections={[]}
        isSelected={false}
        onToggleSelection={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMoveToCollection={vi.fn()}
        onDuplicate={vi.fn()}
        onClick={onClick}
      />,
    );

    const openButton = screen.getByRole("button", { name: "Open Team plan" });
    openButton.focus();
    fireEvent.keyDown(openButton, { key: "Enter" });
    fireEvent.click(openButton);
    expect(onClick).toHaveBeenCalledWith("drawing-1", expect.anything());
  });

  it("offers a visible card actions button and closes its menu with Escape", async () => {
    render(
      <DrawingCard
        drawing={drawing}
        collections={[]}
        isSelected={false}
        onToggleSelection={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMoveToCollection={vi.fn()}
        onDuplicate={vi.fn()}
        onClick={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for Team plan" }));
    expect(screen.getByRole("menu", { name: "Actions for Team plan" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /rename/i })).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("announces confirmation dialogs, traps focus, handles Escape, and restores focus", () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <>
        <button type="button">Before dialog</button>
        <ConfirmModal
          isOpen={false}
          title="Delete Drawing"
          message="This cannot be undone."
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />
      </>,
    );
    const trigger = screen.getByRole("button", { name: "Before dialog" });
    trigger.focus();

    rerender(
      <>
        <button type="button">Before dialog</button>
        <ConfirmModal
          isOpen
          title="Delete Drawing"
          message="This cannot be undone."
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />
      </>,
    );

    const dialog = screen.getByRole("dialog", { name: "Delete Drawing" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <>
        <button type="button">Before dialog</button>
        <ConfirmModal
          isOpen={false}
          title="Delete Drawing"
          message="This cannot be undone."
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />
      </>,
    );
    expect(trigger).toHaveFocus();
  });
});
