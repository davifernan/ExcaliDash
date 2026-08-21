/**
 * Keeping Excalidraw's text hint away from sticky notes.
 *
 * The editor is told through an attribute on the container rather than by
 * reaching into its DOM: the stylesheet next door reads that attribute, so the
 * worst that a renamed hint element can do is leave the hint showing, which is
 * where it started.
 */
import { useEffect } from "react";
import { isStickyNote } from "./stickyNote";
import "./stickyHint.css";

/** True when the only thing selected, or being typed into, is a note. */
function stickyIsTheSelection(api: any): boolean {
  const appState = api?.getAppState?.();
  if (!appState) return false;

  const elements = api.getSceneElements();
  const byId = (id: string) => elements.find((element: any) => element.id === id);

  const editing = appState.editingTextElement;
  if (editing?.containerId) return isStickyNote(byId(editing.containerId));

  const selected = Object.entries(appState.selectedElementIds ?? {})
    .filter(([, on]) => on)
    .map(([id]) => id);
  return selected.length === 1 && isStickyNote(byId(selected[0]));
}

export function useStickyHint({
  excalidrawAPI,
  containerRef,
  canEdit,
  ready,
}: {
  excalidrawAPI: { current: any };
  containerRef: React.RefObject<HTMLElement>;
  canEdit: boolean;
  /**
   * Whether the editor has handed over its API yet.
   *
   * Without it this effect would run once on mount, find nothing to subscribe
   * to and never try again — a mistake this code has made twice before, both
   * times silently.
   */
  ready: boolean;
}) {
  useEffect(() => {
    const container = containerRef.current;
    const api = excalidrawAPI.current;
    if (!ready || !container || !api?.onChange || !canEdit) return;

    const update = () => {
      const on = stickyIsTheSelection(excalidrawAPI.current);
      if (on) container.dataset.stickySelection = "true";
      else delete container.dataset.stickySelection;
    };

    update();
    const stop = api.onChange(update);
    return () => {
      stop?.();
      delete container.dataset.stickySelection;
    };
  }, [canEdit, containerRef, excalidrawAPI, ready]);
}
