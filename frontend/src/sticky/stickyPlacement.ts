/**
 * Putting a note on the board and getting the cursor into it.
 *
 * Opening the label editor is the one step with no public API. Excalidraw
 * starts it from a real Enter key on a selected container and exposes no way to
 * ask for it directly, so the note is added, selected, and then sent an Enter.
 * Whether that took is read back out of the app state rather than assumed — on
 * a phone the keyboard may refuse to rise without a genuine tap, and a future
 * version may bind the key elsewhere. Either way the note exists and is
 * selected, and the caller can say which key to press.
 */
import { STICKY_BASE_FONT_SIZE, type StickyColor } from "./stickyNote";

/** Space between a note and the one spawned next to it. */
export const STICKY_GAP = 24;

function pressEnter(container: HTMLElement | null): void {
  const target = container?.querySelector(".excalidraw") ?? container;
  target?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
}

export type InsertResult = { typing: boolean };

export function insertStickyNote(
  api: any,
  containerEl: HTMLElement | null,
  note: any,
  color: StickyColor,
  onDone?: (result: InsertResult) => void,
): void {
  if (!api) return;

  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), note],
    appState: {
      selectedElementIds: { [note.id]: true },
      // The label Excalidraw is about to create takes its size and colour from
      // these, and the note's upkeep expects to start from that size.
      currentItemFontSize: STICKY_BASE_FONT_SIZE,
      currentItemStrokeColor: color.ink,
    },
  });

  // The scene update is React state. The key has to arrive after it has been
  // committed, or Excalidraw finds nothing selected to type into.
  requestAnimationFrame(() => {
    pressEnter(containerEl);
    const typing = api.getAppState?.()?.editingTextElement?.containerId === note.id;
    onDone?.({ typing });
  });
}
