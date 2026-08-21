import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useEditorChrome } from "./useEditorChrome";

describe("useEditorChrome", () => {
  beforeEach(() => {
    document.title = "Original Title";
    window.localStorage.clear();
  });

  it("updates document title and restores app title on unmount", () => {
    const { rerender, unmount } = renderHook(
      ({ drawingName }) => useEditorChrome({ drawingName }),
      { initialProps: { drawingName: "Roadmap" } },
    );

    expect(document.title).toBe("Roadmap - ExcaliDash");

    rerender({ drawingName: "Architecture" });
    expect(document.title).toBe("Architecture - ExcaliDash");

    unmount();
    expect(document.title).toBe("ExcaliDash");
  });

  it("clears the abandoned auto-hide preference, once", () => {
    window.localStorage.setItem("excalidash:editor:abc:autoHideEnabled", "0");
    window.localStorage.setItem("excalidash:editor:def:autoHideEnabled", "1");
    window.localStorage.setItem("excalidash:editor:abc:somethingElse", "keep me");

    renderHook(() => useEditorChrome({ drawingName: "Roadmap" }));

    expect(window.localStorage.getItem("excalidash:editor:abc:autoHideEnabled")).toBeNull();
    expect(window.localStorage.getItem("excalidash:editor:def:autoHideEnabled")).toBeNull();
    expect(window.localStorage.getItem("excalidash:editor:abc:somethingElse")).toBe("keep me");

    // A later write under the old key belongs to whoever wrote it; the cleanup
    // is a one-off migration, not a standing rule that keeps deleting things.
    window.localStorage.setItem("excalidash:editor:ghi:autoHideEnabled", "1");
    renderHook(() => useEditorChrome({ drawingName: "Roadmap" }));
    expect(window.localStorage.getItem("excalidash:editor:ghi:autoHideEnabled")).toBe("1");
  });

  it("survives storage being blocked outright", () => {
    const getItem = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error("blocked");
    };

    expect(() => renderHook(() => useEditorChrome({ drawingName: "Roadmap" }))).not.toThrow();
    expect(document.title).toBe("Roadmap - ExcaliDash");

    window.localStorage.getItem = getItem;
  });
});
