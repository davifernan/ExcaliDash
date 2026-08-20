import { describe, expect, it } from "vitest";
import { elementContentSignature, reconcileElements } from "./sync";

const el = (id: string, over: Record<string, any> = {}) => ({
  id,
  type: "rectangle",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  angle: 0,
  version: 1,
  versionNonce: 1,
  updated: 1000,
  isDeleted: false,
  ...over,
});

describe("choosing between two versions of an element", () => {
  it("takes the newer revision", () => {
    const merged = reconcileElements([el("a", { version: 2 })], [el("a", { version: 5, x: 9 })]);
    expect(merged[0].x).toBe(9);
  });

  it("keeps the newer revision when the incoming one is older", () => {
    const merged = reconcileElements([el("a", { version: 5, x: 9 })], [el("a", { version: 2 })]);
    expect(merged[0].x).toBe(9);
  });

  it("falls back to the timestamp at the same revision", () => {
    const merged = reconcileElements(
      [el("a", { updated: 1000 })],
      [el("a", { updated: 2000, x: 9 })],
    );
    expect(merged[0].x).toBe(9);
  });

  it("reaches the same answer on both machines when two people edit at once", () => {
    // The heart of it: same revision, same millisecond, different nonces. Each
    // client sees its own element as local and the other's as remote. If the
    // rule is not symmetric they swap and the boards drift apart.
    const mine = el("a", { versionNonce: 700, x: 1 });
    const theirs = el("a", { versionNonce: 300, x: 2 });

    const onMyScreen = reconcileElements([mine], [theirs]);
    const onTheirScreen = reconcileElements([theirs], [mine]);

    expect(onMyScreen[0].x).toBe(onTheirScreen[0].x);
    // Lower nonce wins, so it is theirs — but the point is that both agree.
    expect(onMyScreen[0].x).toBe(2);
  });

  it("does not hand an element back and forth on repeated merges", () => {
    const mine = el("a", { versionNonce: 700, x: 1 });
    const theirs = el("a", { versionNonce: 300, x: 2 });
    let scene = reconcileElements([mine], [theirs]);
    scene = reconcileElements(scene, [theirs]);
    scene = reconcileElements(scene, [theirs]);
    expect(scene[0].x).toBe(2);
  });

  it("accepts an incoming element nobody here has seen", () => {
    const merged = reconcileElements([el("a")], [el("b")]);
    expect(merged.map((e) => e.id).sort()).toEqual(["a", "b"]);
  });

  it("notices a change that only altered the contents", () => {
    // Live drag frames are broadcast without touching version or timestamp.
    const merged = reconcileElements([el("a")], [el("a", { x: 42 })]);
    expect(merged[0].x).toBe(42);
  });

  it("notices a recolouring that moved nothing", () => {
    const merged = reconcileElements(
      [el("a", { backgroundColor: "#fef08a" })],
      [el("a", { backgroundColor: "#bfdbfe" })],
    );
    expect(merged[0].backgroundColor).toBe("#bfdbfe");
  });

  it("notices a font size change that moved nothing", () => {
    const merged = reconcileElements(
      [el("a", { type: "text", fontSize: 20 })],
      [el("a", { type: "text", fontSize: 12 })],
    );
    expect(merged[0].fontSize).toBe(12);
  });

  it("notices note metadata changing on its own", () => {
    const merged = reconcileElements(
      [el("a", { customData: { sticky: { color: "yellow" } } })],
      [el("a", { customData: { sticky: { color: "blue" } } })],
    );
    expect(merged[0].customData.sticky.color).toBe("blue");
  });
});

describe("elements this client is holding", () => {
  it("refuses an incoming copy of an element being edited here", () => {
    const merged = reconcileElements(
      [el("a", { type: "text", text: "what I am typing" })],
      [el("a", { type: "text", text: "stale", version: 99 })],
      { protect: new Set(["a"]) },
    );
    expect(merged[0].text).toBe("what I am typing");
  });

  it("still accepts incoming changes to everything else", () => {
    const merged = reconcileElements(
      [el("a"), el("b")],
      [el("a", { version: 99, x: 7 }), el("b", { version: 99, x: 7 })],
      { protect: new Set(["a"]) },
    );
    const byId = Object.fromEntries(merged.map((e) => [e.id, e]));
    expect(byId.a.x).toBe(0);
    expect(byId.b.x).toBe(7);
  });
});

describe("the content fingerprint", () => {
  it("survives note metadata it cannot serialise", () => {
    const looping: any = { sticky: {} };
    looping.sticky.self = looping;
    expect(() => elementContentSignature(el("a", { customData: looping }))).not.toThrow();
  });

  it("stays bounded for enormous metadata", () => {
    const huge = { sticky: { note: "x".repeat(100_000) } };
    expect(elementContentSignature(el("a", { customData: huge })).length).toBeLessThan(600);
  });
});
