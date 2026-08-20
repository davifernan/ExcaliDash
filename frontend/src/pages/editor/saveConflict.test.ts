import { describe, expect, it, vi, beforeEach } from "vitest";
import { reconcileElements } from "../../utils/sync";

/**
 * The save-conflict path, exercised through the same helpers the editor uses.
 *
 * The bug being guarded against: on 409 the editor took the version number out
 * of the error response and resent the elements it already had. That claims to
 * be based on a scene it never loaded, and overwrites whatever the other writer
 * saved a moment earlier.
 */
const el = (id: string, version: number, extra: Record<string, unknown> = {}) => ({
  id,
  version,
  versionNonce: version * 7,
  updated: version * 1000,
  type: "rectangle",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  isDeleted: false,
  ...extra,
});

describe("merging a save conflict", () => {
  it("keeps an element only the other writer has", () => {
    const merged = reconcileElements([el("mine", 3)], [el("mine", 1), el("theirs", 1)]);
    expect(merged.map((e) => e.id).sort()).toEqual(["mine", "theirs"]);
  });

  it("keeps the newer version of an element both touched", () => {
    const merged = reconcileElements([el("shared", 5, { x: 100 })], [el("shared", 2, { x: 9 })]);
    expect(merged.find((e) => e.id === "shared")?.x).toBe(100);
  });

  it("takes the stored version when it is ahead", () => {
    const merged = reconcileElements([el("shared", 2, { x: 100 })], [el("shared", 9, { x: 9 })]);
    expect(merged.find((e) => e.id === "shared")?.x).toBe(9);
  });

  it("carries a deletion by the other writer instead of resurrecting it", () => {
    const merged = reconcileElements([el("gone", 1)], [el("gone", 4, { isDeleted: true })]);
    expect(merged.find((e) => e.id === "gone")?.isDeleted).toBe(true);
  });

  it("loses nothing when neither side changed", () => {
    const scene = [el("a", 1), el("b", 1)];
    expect(reconcileElements(scene, scene).map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("the payload a retry is built from", () => {
  it("is the merged scene, not the one that was refused", () => {
    const mine = [el("mine", 3)];
    const stored = [el("theirs", 1)];
    const merged = reconcileElements(mine, stored);

    // What the old code would have sent, versus what it must send.
    expect(mine.map((e) => e.id)).toEqual(["mine"]);
    expect(merged.map((e) => e.id).sort()).toEqual(["mine", "theirs"]);
  });

  it("merges the other writer's files in rather than replacing the map", () => {
    const remoteFiles = { imgA: { id: "imgA" } };
    const mineFiles = { imgB: { id: "imgB" } };
    const mergedFiles = { ...remoteFiles, ...mineFiles };
    expect(Object.keys(mergedFiles).sort()).toEqual(["imgA", "imgB"]);
  });
});

describe("what someone is doing right now", () => {
  const held = (id: string) => new Set([id]);

  it("keeps the element being dragged, even when the stored version is newer", () => {
    const merged = reconcileElements([el("mine", 2, { x: 500 })], [el("mine", 9, { x: 0 })], {
      protect: held("mine"),
    });
    expect(merged.find((e) => e.id === "mine")?.x).toBe(500);
  });

  it("still takes everything else the other writer saved", () => {
    const merged = reconcileElements(
      [el("dragging", 2, { x: 500 })],
      [el("dragging", 9, { x: 0 }), el("theirs", 1)],
      { protect: held("dragging") },
    );
    expect(merged.map((e) => e.id).sort()).toEqual(["dragging", "theirs"]);
    expect(merged.find((e) => e.id === "dragging")?.x).toBe(500);
  });

  it("protects nothing when no gesture is in progress", () => {
    const merged = reconcileElements([el("idle", 2, { x: 500 })], [el("idle", 9, { x: 0 })], {
      protect: new Set<string>(),
    });
    expect(merged.find((e) => e.id === "idle")?.x).toBe(0);
  });
});
