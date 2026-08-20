import { describe, expect, it } from "vitest";
import { HANDLE_OUTSET, HANDLE_SIDES, handlePoint, noteAt, startPoint } from "./stickyConnect";
import { createStickyNote, isStickyNote } from "./stickyNote";

const note = { x: 100, y: 200, width: 200, height: 200 };

describe("where the points sit", () => {
  it("puts one on the middle of each edge", () => {
    expect(handlePoint(note, "top")).toEqual({ x: 200, y: 200 });
    expect(handlePoint(note, "bottom")).toEqual({ x: 200, y: 400 });
    expect(handlePoint(note, "left")).toEqual({ x: 100, y: 300 });
    expect(handlePoint(note, "right")).toEqual({ x: 300, y: 300 });
  });

  it("offers one per side and no more", () => {
    expect(HANDLE_SIDES).toHaveLength(4);
    expect(new Set(HANDLE_SIDES).size).toBe(4);
  });

  it("follows a note that was made wider", () => {
    const wide = { ...note, width: 600 };
    expect(handlePoint(wide, "right").x).toBe(700);
    expect(handlePoint(wide, "top").x).toBe(400);
  });
});

describe("where the arrow starts", () => {
  it("begins just outside the note, not on its outline", () => {
    // On the line itself the press reads as a click inside the shape, which
    // drags the note instead of drawing from it.
    expect(startPoint(note, "right")).toEqual({ x: 300 + HANDLE_OUTSET, y: 300 });
    expect(startPoint(note, "left")).toEqual({ x: 100 - HANDLE_OUTSET, y: 300 });
    expect(startPoint(note, "top")).toEqual({ x: 200, y: 200 - HANDLE_OUTSET });
    expect(startPoint(note, "bottom")).toEqual({ x: 200, y: 400 + HANDLE_OUTSET });
  });

  it("stays close enough that the arrow still binds to the note", () => {
    for (const side of HANDLE_SIDES) {
      const from = startPoint(note, side);
      const on = handlePoint(note, side);
      const distance = Math.hypot(from.x - on.x, from.y - on.y);
      expect(distance).toBeLessThanOrEqual(HANDLE_OUTSET);
    }
  });
});

describe("finding the note under the pointer", () => {
  const a = { ...createStickyNote(200, 300), id: "a" };
  const b = { ...createStickyNote(600, 300), id: "b" };

  it("finds the one the point is inside", () => {
    expect(noteAt([a, b], isStickyNote, 200, 300)?.id).toBe("a");
    expect(noteAt([a, b], isStickyNote, 600, 300)?.id).toBe("b");
  });

  it("finds nothing in the space between them", () => {
    expect(noteAt([a, b], isStickyNote, 420, 300)).toBeNull();
  });

  it("takes the topmost when two overlap", () => {
    const under = { ...createStickyNote(200, 300), id: "under" };
    const over = { ...createStickyNote(200, 300), id: "over" };
    expect(noteAt([under, over], isStickyNote, 200, 300)?.id).toBe("over");
  });

  it("ignores a note that was deleted", () => {
    expect(noteAt([{ ...a, isDeleted: true }], isStickyNote, 200, 300)).toBeNull();
  });

  it("ignores anything that is not a note", () => {
    const plain = { id: "r", type: "rectangle", x: 0, y: 0, width: 500, height: 500 };
    expect(noteAt([plain], isStickyNote, 100, 100)).toBeNull();
  });

  it("counts the edge as inside, which is where the points are", () => {
    expect(noteAt([a], isStickyNote, a.x, a.y)?.id).toBe("a");
    expect(noteAt([a], isStickyNote, a.x + a.width, a.y + a.height)?.id).toBe("a");
  });
});
