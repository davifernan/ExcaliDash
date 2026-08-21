import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { planAssetOwnership } = require("../../scripts/backfill-collection-ownership.cjs");

const link = (drawingId: string, assetId: string) => ({ drawingId, assetId });

describe("which documents may follow their board to a new owner", () => {
  // An asset has one owner, so rewriting it reaches every board that uses it.
  // The script used to look only at the boards it was moving, which meant a
  // document shared with a board outside the run changed hands without that
  // board's owner appearing anywhere in the report.
  it("leaves a document alone when a board outside the run still uses it", () => {
    const plan = planAssetOwnership({
      links: [link("moving-board", "shared-doc")],
      outsideLinks: [link("moving-board", "shared-doc"), link("untouched-board", "shared-doc")],
      futureOwnerOf: new Map([["moving-board", "new-owner"]]),
    });

    expect(plan.rewrite.has("shared-doc")).toBe(false);
    expect(plan.shared).toEqual(["shared-doc"]);
    expect(plan.ambiguous).toEqual([]);
  });

  it("moves a document that only the boards in this run use", () => {
    const plan = planAssetOwnership({
      links: [link("a", "doc"), link("b", "doc")],
      outsideLinks: [link("a", "doc"), link("b", "doc")],
      futureOwnerOf: new Map([
        ["a", "new-owner"],
        ["b", "new-owner"],
      ]),
    });

    expect(plan.rewrite.has("doc")).toBe(true);
    expect(plan.shared).toEqual([]);
  });

  it("still refuses when the moving boards land on different owners", () => {
    const plan = planAssetOwnership({
      links: [link("a", "doc"), link("b", "doc")],
      outsideLinks: [link("a", "doc"), link("b", "doc")],
      futureOwnerOf: new Map([
        ["a", "owner-one"],
        ["b", "owner-two"],
      ]),
    });

    expect(plan.ambiguous).toEqual(["doc"]);
    expect(plan.rewrite.size).toBe(0);
  });

  it("prefers refusing over skipping when a document is both shared and ambiguous", () => {
    // Two owners AND an outsider. Stopping is the safer of the two answers:
    // skipping quietly would leave a database nobody has looked at.
    const plan = planAssetOwnership({
      links: [link("a", "doc"), link("b", "doc")],
      outsideLinks: [link("a", "doc"), link("b", "doc"), link("outside", "doc")],
      futureOwnerOf: new Map([
        ["a", "owner-one"],
        ["b", "owner-two"],
      ]),
    });

    expect(plan.ambiguous).toEqual(["doc"]);
    expect(plan.shared).toEqual([]);
  });

  it("decides each document on its own", () => {
    const plan = planAssetOwnership({
      links: [link("a", "own-doc"), link("a", "shared-doc")],
      outsideLinks: [link("a", "own-doc"), link("a", "shared-doc"), link("outside", "shared-doc")],
      futureOwnerOf: new Map([["a", "new-owner"]]),
    });

    expect(Array.from(plan.rewrite)).toEqual(["own-doc"]);
    expect(plan.shared).toEqual(["shared-doc"]);
  });
});
