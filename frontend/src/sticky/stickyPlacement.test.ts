import { describe, expect, it } from "vitest";
import { frameAt, withNoteInserted } from "./stickyPlacement";
import { createStickyNote } from "./stickyNote";

const frame = (id: string, x: number, y: number, w = 400, h = 300) => ({
  id,
  type: "frame",
  x,
  y,
  width: w,
  height: h,
  isDeleted: false,
});

describe("the frame a note lands in", () => {
  const outer = frame("outer", 0, 0, 800, 600);
  const inner = frame("inner", 100, 100, 200, 200);

  it("finds the frame under the point", () => {
    expect(frameAt([outer], 400, 300)?.id).toBe("outer");
  });

  it("finds nothing outside every frame", () => {
    expect(frameAt([outer], 900, 300)).toBeNull();
  });

  it("takes the topmost when frames are nested", () => {
    expect(frameAt([outer, inner], 200, 200)?.id).toBe("inner");
  });

  it("ignores a frame that was deleted", () => {
    expect(frameAt([{ ...outer, isDeleted: true }], 400, 300)).toBeNull();
  });

  it("ignores everything that is not a frame", () => {
    const note = createStickyNote(400, 300);
    expect(frameAt([note], 400, 300)).toBeNull();
  });

  it("counts the edge as inside", () => {
    expect(frameAt([outer], 0, 0)?.id).toBe("outer");
    expect(frameAt([outer], 800, 600)?.id).toBe("outer");
  });
});

describe("where the note goes in the element list", () => {
  it("goes last when it belongs to no frame", () => {
    const note = createStickyNote(0, 0);
    const before = [{ id: "a" }, { id: "b" }];
    expect(withNoteInserted(before, note).map((e: any) => e.id)).toEqual(["a", "b", note.id]);
  });

  it("goes immediately before its frame, where Excalidraw keeps members", () => {
    const note = { ...createStickyNote(0, 0), frameId: "f" };
    const before = [{ id: "a" }, { id: "f" }, { id: "z" }];
    expect(withNoteInserted(before, note).map((e: any) => e.id)).toEqual(["a", note.id, "f", "z"]);
  });

  it("falls back to the end when the frame is not on the board", () => {
    const note = { ...createStickyNote(0, 0), frameId: "ghost" };
    const before = [{ id: "a" }];
    expect(withNoteInserted(before, note).map((e: any) => e.id)).toEqual(["a", note.id]);
  });

  it("leaves the board it was given untouched", () => {
    const note = createStickyNote(0, 0);
    const before = [{ id: "a" }];
    withNoteInserted(before, note);
    expect(before).toHaveLength(1);
  });
});

describe("the index a new note carries", () => {
  it("is left for Excalidraw to assign", () => {
    // Handing it one means handing it "a0", the lowest there is, because it was
    // indexed inside a one-element array. Null says "not placed yet", and the
    // editor then gives it an index that follows whatever it is appended after.
    expect(createStickyNote(0, 0).index).toBeNull();
  });
});
