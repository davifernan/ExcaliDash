/**
 * Where you are, and the way back.
 *
 * This used to be the left half of a full-width bar that hid itself after three
 * seconds and came back only if the pointer found a five pixel strip along the
 * top of the window. It is now a small island floating over the canvas, in the
 * corner where every other whiteboard puts the same two things.
 *
 * It renders through a portal into Excalidraw's own root, which buys two things
 * for free: its colours come from Excalidraw's tokens, so light and dark agree
 * without us repeating ourselves, and `--ui-pointerEvents` makes it transparent
 * to the pointer while somebody is drawing. You draw straight through it.
 */
import React from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Loader2 } from "lucide-react";

type EditorTopLeftProps = {
  container: HTMLElement | null;
  zenMode: boolean;
  mobile: boolean;
  drawingName: string;
  canEdit: boolean;
  isRenaming: boolean;
  isSavingOnLeave: boolean;
  newName: string;
  onBackClick: () => void;
  onNewNameChange: (value: string) => void;
  onRenameBlur: () => void;
  onRenameStart: () => void;
  onRenameSubmit: (event: React.FormEvent) => void;
};

const island: React.CSSProperties = {
  position: "absolute",
  top: "var(--editor-container-padding, 1rem)",
  insetInlineStart: "var(--editor-container-padding, 1rem)",
  zIndex: 4,
  display: "flex",
  alignItems: "center",
  gap: "0.25rem",
  maxWidth: "min(24rem, calc(100% - 2rem))",
  height: "2.25rem",
  padding: "0 0.35rem",
  borderRadius: "var(--border-radius-lg, 0.5rem)",
  background: "var(--island-bg-color, #fff)",
  boxShadow: "var(--shadow-island, 0 1px 4px rgba(0,0,0,.15))",
  color: "var(--text-primary-color, #1b1b1f)",
  // Excalidraw turns this off mid-gesture; inheriting it is the whole point.
  pointerEvents: "var(--ui-pointerEvents)" as React.CSSProperties["pointerEvents"],
  // Same easing Excalidraw uses for its own panels, so the island leaves in step
  // with them rather than a beat apart. Visibility flips only once the slide is
  // over, which takes the island out of the tab order instead of leaving seven
  // invisible stops behind -- the exact trap the old hidden header set.
  transition: "transform 0.5s ease-in-out, visibility 0s linear 0.5s",
};

const iconButton: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.75rem",
  height: "1.75rem",
  border: "none",
  borderRadius: "var(--border-radius-md, 0.375rem)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  flex: "0 0 auto",
};

const nameStyle: React.CSSProperties = {
  font: "inherit",
  fontSize: "0.8125rem",
  fontWeight: 600,
  padding: "0.15rem 0.35rem",
  borderRadius: "var(--border-radius-md, 0.375rem)",
  cursor: "text",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};

export const EditorTopLeft: React.FC<EditorTopLeftProps> = ({
  container,
  zenMode,
  mobile,
  drawingName,
  canEdit,
  isRenaming,
  isSavingOnLeave,
  newName,
  onBackClick,
  onNewNameChange,
  onRenameBlur,
  onRenameStart,
  onRenameSubmit,
}) => {
  // On the mobile layout Excalidraw moves its tool row to the top of the screen,
  // exactly where this island sits; it covered the first four tools. The back
  // route lives in the main menu instead, which is at the bottom on that layout.
  if (!container || mobile) return null;

  return createPortal(
    <div
      style={{
        ...island,
        transform: zenMode ? "translateX(-999px)" : undefined,
        visibility: zenMode ? "hidden" : "visible",
        transition: zenMode
          ? island.transition
          : "transform 0.5s ease-in-out, visibility 0s linear 0s",
      }}
      data-testid="editor-top-left"
      aria-hidden={zenMode}
    >
      <button
        onClick={onBackClick}
        disabled={isSavingOnLeave}
        style={{ ...iconButton, cursor: isSavingOnLeave ? "wait" : "pointer" }}
        title={isSavingOnLeave ? "Saving changes..." : "Back to dashboard"}
        aria-label={isSavingOnLeave ? "Saving changes" : "Back to dashboard"}
        data-testid="editor-back"
      >
        {isSavingOnLeave ? <Loader2 size={16} className="animate-spin" /> : <ArrowLeft size={16} />}
      </button>

      {isRenaming ? (
        <form onSubmit={onRenameSubmit} style={{ minWidth: 0 }}>
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={(event) => onNewNameChange(event.target.value)}
            onBlur={onRenameBlur}
            aria-label="Drawing name"
            style={{
              ...nameStyle,
              cursor: "text",
              width: `${Math.max(10, Math.min(24, newName.length + 2))}ch`,
              background: "transparent",
              color: "inherit",
              border: "1px solid var(--color-primary, #6965db)",
              outline: "none",
            }}
          />
        </form>
      ) : (
        <h1
          style={nameStyle}
          onDoubleClick={onRenameStart}
          title={canEdit ? `${drawingName} — double-click to rename` : drawingName}
        >
          {drawingName}
        </h1>
      )}

      {!canEdit ? (
        <span
          style={{
            flex: "0 0 auto",
            fontSize: "0.6875rem",
            fontWeight: 600,
            padding: "0.1rem 0.4rem",
            borderRadius: "999px",
            background: "var(--color-warning-background, #fff3bf)",
            color: "var(--color-warning-dark, #66512c)",
          }}
        >
          Read-only
        </span>
      ) : null}
    </div>,
    container,
  );
};
