import { describe, expect, it } from "vitest";
import { parseElementUpdatePayload } from "./socketProtocol";

describe("element update payloads", () => {
  it("accepts ordering for a board larger than 20,000 elements", () => {
    const elementOrder = Array.from({ length: 20_001 }, (_, index) => `element-${index}`);

    const parsed = parseElementUpdatePayload({
      drawingId: "drawing-1",
      elements: [{ id: "changed-element" }],
      elementOrder,
    });

    expect(parsed?.drawingId).toBe("drawing-1");
    expect(parsed?.elements).toEqual([{ id: "changed-element" }]);
    expect(parsed?.elementOrder).toBe(elementOrder);
  });

  it("keeps element content when ordering exceeds the byte budget", () => {
    const elementOrder = Array.from(
      { length: 42_000 },
      (_, index) => `${index.toString().padStart(6, "0")}-${"x".repeat(193)}`,
    );

    const parsed = parseElementUpdatePayload({
      drawingId: "drawing-1",
      elements: [{ id: "important-change" }],
      elementOrder,
    });

    expect(parsed?.elements).toEqual([{ id: "important-change" }]);
    expect(parsed?.elementOrder).toBeUndefined();
    expect((parsed as any)?.elementOrderOmittedBytes).toBeGreaterThan(8 * 1024 * 1024);
  });
});
