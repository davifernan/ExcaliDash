/**
 * Tab for the next note.
 *
 * This is the shortcut that makes a brainstorm fast: write a note, Tab, write
 * the next one, without going back to the toolbar between thoughts.
 *
 * It works from a selected note rather than from inside one, which is one press
 * more than tldraw asks for. Inside the label, Tab belongs to Excalidraw — it
 * indents, and it calls preventDefault to do so. Taking it away there would
 * mean reaching into a private text editor and would break the first time that
 * editor changed. Escape, then Tab.
 */
import { useEffect } from "react";
import { STICKY_GAP, insertStickyNote } from "./stickyPlacement";
import { createStickyNote, stickyColorById, stickyDataOf } from "./stickyNote";

type Options = {
  excalidrawAPI: { current: any };
  containerRef: React.RefObject<HTMLElement>;
  canEdit: boolean;
};

/** The single selected note, if that is what is selected. */
function selectedNote(api: any): any | null {
  const appState = api?.getAppState?.();
  if (!appState || appState.editingTextElement) return null;

  const ids = Object.entries(appState.selectedElementIds ?? {})
    .filter(([, selected]) => selected)
    .map(([id]) => id);
  if (ids.length !== 1) return null;

  const note = api.getSceneElements().find((element: any) => element.id === ids[0]);
  return stickyDataOf(note) ? note : null;
}

/** Where the next note goes, centred like every other note. */
export function nextNoteCentre(
  note: any,
  direction: "left" | "right" | "down",
): { x: number; y: number } {
  const centreX = note.x + note.width / 2;
  const centreY = note.y + note.height / 2;
  if (direction === "down") {
    return { x: centreX, y: centreY + note.height + STICKY_GAP };
  }
  const step = note.width + STICKY_GAP;
  return { x: centreX + (direction === "right" ? step : -step), y: centreY };
}

export function useStickyKeys({ excalidrawAPI, containerRef, canEdit }: Options) {
  useEffect(() => {
    if (!canEdit) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const wantsSideways = event.key === "Tab" && !event.ctrlKey && !event.metaKey;
      const wantsBelow = event.key === "Enter" && (event.ctrlKey || event.metaKey);
      if (!wantsSideways && !wantsBelow) return;

      const api = excalidrawAPI.current;
      const note = selectedNote(api);
      if (!note) return;

      // Only now, once we know the key was meant for us — Tab still has to
      // move focus everywhere else on the page.
      event.preventDefault();
      event.stopPropagation();

      const direction = wantsBelow ? "down" : event.shiftKey ? "left" : "right";
      const centre = nextNoteCentre(note, direction);
      const colour = stickyColorById(stickyDataOf(note)?.color);

      insertStickyNote(
        api,
        containerRef.current,
        createStickyNote(centre.x, centre.y, colour),
        colour,
      );
    };

    const target = containerRef.current;
    if (!target) return;
    target.addEventListener("keydown", onKeyDown);
    return () => target.removeEventListener("keydown", onKeyDown);
  }, [canEdit, containerRef, excalidrawAPI]);
}
