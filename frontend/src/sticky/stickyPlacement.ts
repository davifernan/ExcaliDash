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

/**
 * The frame a note is being dropped into, if any.
 *
 * Excalidraw does this for every element it creates itself: a shape drawn
 * inside a frame becomes part of it, and moving the frame takes the shape
 * along. A note placed by this code skipped that step, so it sat on a frame
 * without belonging to it and stayed behind whenever the frame was moved.
 *
 * Topmost first, because frames can be nested and the innermost one is the one
 * under the pointer.
 */
export function frameAt(elements: readonly any[], x: number, y: number): any | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];
    if (element.isDeleted || element.type !== "frame") continue;
    if (
      x >= element.x &&
      x <= element.x + element.width &&
      y >= element.y &&
      y <= element.y + element.height
    ) {
      return element;
    }
  }
  return null;
}

/**
 * The board with the note in it, in the place that board keeps its members.
 *
 * A frame's children sit immediately before it in the element list; appending
 * elsewhere leaves a note that claims membership the ordering does not reflect.
 */
export function withNoteInserted(elements: readonly any[], note: any): any[] {
  if (!note.frameId) return [...elements, note];
  const at = elements.findIndex((element) => element.id === note.frameId);
  if (at < 0) return [...elements, note];
  return [...elements.slice(0, at), note, ...elements.slice(at)];
}

export function insertStickyNote(
  api: any,
  containerEl: HTMLElement | null,
  note: any,
  color: StickyColor,
  onDone?: (result: InsertResult) => void,
): void {
  if (!api) return;

  const scene = api.getSceneElementsIncludingDeleted();
  const frame = frameAt(scene, note.x + note.width / 2, note.y + note.height / 2);
  const placed = frame ? { ...note, frameId: frame.id } : note;

  api.updateScene({
    elements: withNoteInserted(scene, placed),
    appState: {
      selectedElementIds: { [placed.id]: true },
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
    const typing = api.getAppState?.()?.editingTextElement?.containerId === placed.id;
    onDone?.({ typing });
  });
}
