import { describe, expect, it } from "vitest";
import { sanitizeUrl } from "../security";

describe("document widget links", () => {
  it("preserves only the exact first-party widget identifiers", () => {
    expect(sanitizeUrl("excalidash://pdf-widget")).toBe("excalidash://pdf-widget");
    expect(sanitizeUrl("excalidash://asset-widget")).toBe("excalidash://asset-widget");
    expect(sanitizeUrl("excalidash://asset-widget/evil")).toBe("");
    expect(sanitizeUrl("excalidash://anything-else")).toBe("");
  });
});
