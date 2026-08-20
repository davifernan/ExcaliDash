/**
 * Running the note upkeep off the editor's own change events.
 *
 * Two things make this safe to hang off `onChange`. The pass is still — given a
 * scene it has already settled it reports no change at all — so the update it
 * triggers ends the cycle rather than starting a new one. And the work is
 * deferred out of the change callback, because calling `updateScene` while
 * Excalidraw is still telling us about the last one is how integrations
 * deadlock themselves.
 */
import { useCallback, useEffect, useRef } from "react";
import { normaliseStickyNotes } from "./stickyNormalise";

/** Matches CaptureUpdateAction.NEVER — an automatic tidy is not an undo step. */
const CAPTURE_UPDATE_NEVER = "NEVER";

type Options = {
  excalidrawAPI: { current: any };
  canEdit: boolean;
};

export function useStickyUpkeep({ excalidrawAPI, canEdit }: Options) {
  /** The note under a resize handle on the previous change, if any. */
  const wasResizing = useRef<string | null>(null);
  const queued = useRef(false);
  const alive = useRef(true);

  // Set on the way in as well as cleared on the way out. React mounts an effect
  // twice in development, and a flag only ever cleared would stay cleared after
  // that second pass — the upkeep would then quietly do nothing at all, which
  // is exactly what it did until a browser test caught it.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const onSceneChange = useCallback(
    (elements: readonly any[], appState: any) => {
      if (!canEdit || !elements?.length) return;

      const resizingId = appState?.resizingElement?.id ?? null;
      // A resize that ended between the last change and this one: the size the
      // person let go of is the size the note should now defend.
      const justResized = wasResizing.current && !resizingId ? wasResizing.current : null;
      wasResizing.current = resizingId;

      // Mid-gesture. Measuring now would fight the drag and settle on a size
      // that is wrong a frame later.
      if (resizingId || appState?.newElement) return;

      const editingId = appState?.editingTextElement?.id ?? null;

      if (queued.current) return;
      queued.current = true;

      queueMicrotask(() => {
        queued.current = false;
        if (!alive.current) return;

        const api = excalidrawAPI.current;
        if (!api) return;

        const next = normaliseStickyNotes(api.getSceneElementsIncludingDeleted(), {
          resized: justResized ? new Set([justResized]) : null,
          editing: editingId ? new Set([editingId]) : null,
        });
        if (!next) return;

        api.updateScene({ elements: next, captureUpdate: CAPTURE_UPDATE_NEVER });
      });
    },
    [canEdit, excalidrawAPI],
  );

  return { onSceneChange };
}
