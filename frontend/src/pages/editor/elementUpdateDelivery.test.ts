import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createElementMarkerTransaction,
  createElementUpdateDelivery,
  createFileMarkerTransaction,
  splitFilesIntoUpdatePayloads,
} from "./elementUpdateDelivery";

const drawingId = "drawing-1";

describe("element update delivery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("rolls sync markers back and retransmits a refused change", async () => {
    const elementVersions = { current: new Map<string, any>() };
    const order = { current: "old-order" };
    const previous = { version: 1 };
    elementVersions.current.set("element-1", previous);
    const next = { id: "element-1", version: 2 };
    const emit = vi.fn();
    const delivery = createElementUpdateDelivery({ emit, settleMs: 10, retryMs: 20 });
    const marker = createElementMarkerTransaction({
      elements: [next],
      elementVersionMap: elementVersions,
      lastSyncedElementOrderSigRef: order,
      nextOrderSig: "new-order",
      recordElementVersion: (element) => {
        elementVersions.current.set(element.id, { version: element.version });
      },
    });

    const result = delivery.deliver([
      { payload: { drawingId, elements: [next], elementOrder: [next.id] }, marker },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(elementVersions.current.get(next.id)).toEqual({ version: 2 });
    expect(order.current).toBe("new-order");

    delivery.refuseActive();
    await vi.advanceTimersByTimeAsync(0);
    expect(elementVersions.current.get(next.id)).toBe(previous);
    expect(order.current).toBe("old-order");

    await vi.advanceTimersByTimeAsync(20);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1][0]).toEqual(emit.mock.calls[0][0]);
    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toBe(true);
  });

  it("gives up on the same permanently refused change after bounded attempts", async () => {
    const emit = vi.fn();
    const onGiveUp = vi.fn();
    const delivery = createElementUpdateDelivery({
      emit,
      maxAttempts: 3,
      settleMs: 10,
      retryMs: 20,
      onGiveUp,
    });
    const update = [{ payload: { drawingId, elements: [{ id: "too-large" }] } }];
    const result = delivery.deliver(update);
    await vi.advanceTimersByTimeAsync(0);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      delivery.refuseActive();
      await vi.advanceTimersByTimeAsync(attempt < 2 ? 20 : 0);
    }
    await expect(result).resolves.toBe(false);
    expect(emit).toHaveBeenCalledTimes(3);
    expect(onGiveUp).toHaveBeenCalledTimes(1);

    const repeated = delivery.deliver(update);
    await vi.advanceTimersByTimeAsync(0);
    expect(emit).toHaveBeenCalledTimes(3);
    await expect(repeated).resolves.toBe(false);
  });

  it("sends split image files before the elements that reference them", async () => {
    const files = {
      first: { id: "first", dataURL: `data:image/gif;base64,${"a".repeat(120)}` },
      second: { id: "second", dataURL: `data:image/svg+xml;base64,${"b".repeat(120)}` },
    };
    const oneFileBytes = new TextEncoder().encode(
      JSON.stringify({ drawingId, elements: [], files: { first: files.first } }),
    ).byteLength;
    const filePayloads = splitFilesIntoUpdatePayloads({
      drawingId,
      files,
      maxBytes: oneFileBytes + 10,
    });
    expect(filePayloads).toHaveLength(2);

    const lastSyncedFilesRef = { current: {} as Record<string, any> };
    const element = { id: "image-element", fileId: "second", version: 1 };
    const packets = [
      ...filePayloads.map((payload) => ({
        payload,
        marker: createFileMarkerTransaction({
          files: payload.files!,
          lastSyncedFilesRef,
        }),
      })),
      { payload: { drawingId, elements: [element] } },
    ];
    const emit = vi.fn();
    const delivery = createElementUpdateDelivery({ emit, settleMs: 10, retryMs: 20 });
    const result = delivery.deliver(packets);
    await vi.advanceTimersByTimeAsync(0);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0].files).toEqual({ first: files.first });
    await vi.advanceTimersByTimeAsync(10);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1][0].files).toEqual({ second: files.second });
    await vi.advanceTimersByTimeAsync(10);
    expect(emit).toHaveBeenCalledTimes(3);
    expect(emit.mock.calls[2][0]).toEqual({ drawingId, elements: [element] });
    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toBe(true);
  });
});
