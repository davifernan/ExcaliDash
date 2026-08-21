import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import { useEditorBroadcast } from "./useEditorBroadcast";
import { computeElementOrderSig } from "./useEditorElementTracking";

const ref = <T>(value: T) => ({ current: value }) as MutableRefObject<T>;

describe("editor broadcast delivery tracking", () => {
  it("does not mark element versions or ordering as sent until the server acknowledges them", () => {
    let acknowledge: ((value: any) => void) | undefined;
    const emit = vi.fn((_event: string, _payload: unknown, ack?: (value: any) => void) => {
      acknowledge = ack;
    });
    const orderRef = ref("old-order");
    const recordElementVersion = vi.fn();
    const element = { id: "element-1", version: 2 };
    const { result } = renderHook(() =>
      useEditorBroadcast({
        drawingId: "drawing-1",
        excalidrawAPI: ref<any>({ getFiles: () => ({}) }),
        lastLocalChangeAtRef: ref(0),
        lastSyncedElementOrderSigRef: orderRef,
        lastSyncedFilesRef: ref({}),
        latestAppStateRef: ref(null),
        latestFilesRef: ref({}),
        socketRef: ref<any>({ emit }),
        debouncedSave: vi.fn(),
        debouncedSavePreview: vi.fn(),
        computeElementOrderSig: () => "new-order",
        hasElementChanged: () => true,
        normalizeImageElementStatus: (elements) => elements,
        recordElementVersion,
        setHasSceneChangesSinceLoad: vi.fn(),
      }),
    );

    act(() => result.current([element], {}));

    expect(recordElementVersion).not.toHaveBeenCalled();
    expect(orderRef.current).toBe("old-order");
    expect(acknowledge).toBeTypeOf("function");

    act(() => acknowledge?.({ ok: true }));

    expect(recordElementVersion).toHaveBeenCalledWith(element);
    expect(orderRef.current).toBe("new-order");
  });

  it("retries unacknowledged element content instead of losing it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const acknowledgements: Array<(value: any) => void> = [];
    const emit = vi.fn((_event: string, _payload: unknown, ack?: (value: any) => void) => {
      if (ack) acknowledgements.push(ack);
    });
    const element = { id: "element-1", version: 2 };
    let sent = false;
    const { result } = renderHook(() =>
      useEditorBroadcast({
        drawingId: "drawing-1",
        excalidrawAPI: ref<any>({ getFiles: () => ({}) }),
        lastLocalChangeAtRef: ref(0),
        lastSyncedElementOrderSigRef: ref("same-order"),
        lastSyncedFilesRef: ref({}),
        latestAppStateRef: ref(null),
        latestFilesRef: ref({}),
        socketRef: ref<any>({ emit }),
        debouncedSave: vi.fn(),
        debouncedSavePreview: vi.fn(),
        computeElementOrderSig: () => "same-order",
        hasElementChanged: () => !sent,
        normalizeImageElementStatus: (elements) => elements,
        recordElementVersion: () => {
          sent = true;
        },
        setHasSceneChangesSinceLoad: vi.fn(),
      }),
    );

    act(() => result.current([element], {}));
    act(() => acknowledgements[0]?.({ ok: false, error: { code: "invalid-request" } }));
    vi.advanceTimersByTime(101);
    act(() => result.current([element], {}));

    expect(emit).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not let deleted elements inflate ordering payloads", () => {
    let payload: any;
    const emit = vi.fn((_event: string, value: unknown) => {
      payload = value;
    });
    const { result } = renderHook(() =>
      useEditorBroadcast({
        drawingId: "drawing-1",
        excalidrawAPI: ref<any>({ getFiles: () => ({}) }),
        lastLocalChangeAtRef: ref(0),
        lastSyncedElementOrderSigRef: ref("old-order"),
        lastSyncedFilesRef: ref({}),
        latestAppStateRef: ref(null),
        latestFilesRef: ref({}),
        socketRef: ref<any>({ emit }),
        debouncedSave: vi.fn(),
        debouncedSavePreview: vi.fn(),
        computeElementOrderSig: () => "new-order",
        hasElementChanged: () => false,
        normalizeImageElementStatus: (elements) => elements,
        recordElementVersion: vi.fn(),
        setHasSceneChangesSinceLoad: vi.fn(),
      }),
    );

    act(() => result.current([{ id: "visible" }, { id: "deleted", isDeleted: true }], {}));

    expect(payload.elementOrder).toEqual(["visible"]);
    expect(computeElementOrderSig([{ id: "visible" }, { id: "deleted", isDeleted: true }])).toBe(
      computeElementOrderSig([{ id: "deleted", isDeleted: true }, { id: "visible" }]),
    );
  });
});
