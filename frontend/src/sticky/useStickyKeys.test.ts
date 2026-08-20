import { describe, expect, it } from "vitest";
import { nextNoteCentre } from "./useStickyKeys";
import { STICKY_GAP } from "./stickyPlacement";
import { STICKY_SIZE, createStickyNote } from "./stickyNote";

describe("where the next note goes", () => {
  const note = createStickyNote(0, 0);

  it("places it a note plus a gap to the right", () => {
    expect(nextNoteCentre(note, "right")).toEqual({ x: STICKY_SIZE + STICKY_GAP, y: 0 });
  });

  it("mirrors that to the left", () => {
    expect(nextNoteCentre(note, "left")).toEqual({ x: -(STICKY_SIZE + STICKY_GAP), y: 0 });
  });

  it("goes straight down without drifting sideways", () => {
    expect(nextNoteCentre(note, "down")).toEqual({ x: 0, y: STICKY_SIZE + STICKY_GAP });
  });

  it("steps by the note's own size, so a widened note still clears itself", () => {
    const wide = { ...note, width: 500 };
    expect(nextNoteCentre(wide, "right").x).toBe(note.x + 500 / 2 + 500 + STICKY_GAP);
  });

  it("leaves a gap rather than butting notes together", () => {
    const first = createStickyNote(0, 0);
    const centre = nextNoteCentre(first, "right");
    const second = createStickyNote(centre.x, centre.y);
    expect(second.x - (first.x + first.width)).toBe(STICKY_GAP);
  });
});
