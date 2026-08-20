/**
 * Arming the note tool, and putting a note where somebody clicked.
 *
 * Excalidraw has a documented seam for exactly this: an active tool of type
 * `custom` makes it create nothing of its own on pointer-down and hand the
 * event to the host instead. So the note is ours to build, while panning,
 * zooming, selection and every other canvas behaviour stay Excalidraw's.
 *
 * Getting the cursor into the new note lives in stickyPlacement, because the
 * shortcut for the next note needs exactly the same steps.
 */
import { useEffect, useState } from "react";
import { insertStickyNote } from "./stickyPlacement";
import {
  DEFAULT_STICKY_COLOR,
  createStickyNote,
  type StickyColor,
} from "./stickyNote";

export const STICKY_TOOL = "sticky";

type Options = {
  excalidrawAPI: { current: any };
  containerRef: React.RefObject<HTMLElement>;
  canEdit: boolean;
  /** Told when a note was placed but typing did not start on its own. */
  onTypingUnavailable?: () => void;
};

export function useStickyNotes({
  excalidrawAPI,
  containerRef,
  canEdit,
  onTypingUnavailable,
}: Options) {
  const [armed, setArmed] = useState(false);
  const [color, setColor] = useState<StickyColor>(DEFAULT_STICKY_COLOR);

  const disarm = () => {
    setArmed(false);
    excalidrawAPI.current?.setActiveTool?.({ type: "selection" });
  };

  const arm = () => {
    if (!canEdit) return;
    if (armed) {
      disarm();
      return;
    }
    setArmed(true);
    excalidrawAPI.current?.setActiveTool?.({
      type: "custom",
      customType: STICKY_TOOL,
    });
  };

  // Placement lives inside the subscription rather than in a callback above it,
  // so the handler always holds the colour the button currently shows. The
  // subscription is torn down and remade when that changes, which is cheap and
  // leaves no stale closure to reason about.
  useEffect(() => {
    const api = excalidrawAPI.current;
    if (!api?.onPointerDown || !canEdit) return;

    return api.onPointerDown((activeTool: any, pointerDownState: any) => {
      if (activeTool?.type !== "custom" || activeTool.customType !== STICKY_TOOL) return;

      // Back to selection straight away: one click, one note. Staying armed
      // would drop another note on every later click on the board.
      setArmed(false);
      api.setActiveTool?.({ type: "selection" });

      const { x, y } = pointerDownState.origin;
      insertStickyNote(
        api,
        containerRef.current,
        createStickyNote(x, y, color),
        color,
        ({ typing }) => {
          if (!typing) onTypingUnavailable?.();
        },
      );
    });
  }, [canEdit, color, containerRef, excalidrawAPI, onTypingUnavailable]);

  // Leaving the tool armed with no way out would trap somebody who changed
  // their mind, and Escape is where everyone reaches first.
  useEffect(() => {
    if (!armed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setArmed(false);
      excalidrawAPI.current?.setActiveTool?.({ type: "selection" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [armed, excalidrawAPI]);

  return { armed, color, arm, disarm, setColor };
}
