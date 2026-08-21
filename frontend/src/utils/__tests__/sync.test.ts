import { describe, expect, it } from "vitest";
import { applyElementOrder } from "../sync";

const element = (id: string) => ({ id, type: "rectangle" });

describe("applying a remote element ordering", () => {
  it("puts elements in the order given", () => {
    const ordered = applyElementOrder([element("a"), element("b")], ["b", "a"]);
    expect(ordered.map((item: any) => item.id)).toEqual(["b", "a"]);
  });

  it("keeps elements the ordering does not mention, after the ones it does", () => {
    // Local-only elements exist: they must not disappear because a peer's
    // ordering knows nothing about them.
    const ordered = applyElementOrder([element("a"), element("local")], ["a"]);
    expect(ordered.map((item: any) => item.id)).toEqual(["a", "local"]);
  });

  it("places an element once even if the ordering names it many times", () => {
    // A small payload could otherwise expand into a huge scene on every
    // receiver: short ids all pointing at one element became one entry each,
    // every one of them a reference to the same thing.
    const repeated = Array.from({ length: 500 }, () => "a");

    const ordered = applyElementOrder([element("a"), element("b")], [...repeated, "b"]);

    expect(ordered).toHaveLength(2);
    expect(ordered.map((item: any) => item.id)).toEqual(["a", "b"]);
  });

  it("ignores ids for elements that are not there", () => {
    const ordered = applyElementOrder([element("a")], ["ghost", "a"]);
    expect(ordered.map((item: any) => item.id)).toEqual(["a"]);
  });
});
