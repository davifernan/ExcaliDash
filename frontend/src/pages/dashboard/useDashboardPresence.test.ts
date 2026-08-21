import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useDashboardPresence } from "./useDashboardPresence";

const getDashboardPresence = vi.fn();

vi.mock("../../api", () => ({
  getDashboardPresence: (...args: unknown[]) => getDashboardPresence(...args),
}));

describe("useDashboardPresence", () => {
  beforeEach(() => {
    getDashboardPresence.mockReset();
    getDashboardPresence.mockResolvedValue([
      { drawingId: "d1", connectedMemberKeys: ["k1"], guestCount: 1 },
    ]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports who is connected, per board", async () => {
    const { result } = renderHook(() => useDashboardPresence(["d1"]));

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current!.get("d1")!.keys.has("k1")).toBe(true);
    expect(result.current!.get("d1")!.guestCount).toBe(1);
  });

  it("keeps asking while the page is open", async () => {
    renderHook(() => useDashboardPresence(["d1"]));
    await waitFor(() => expect(getDashboardPresence).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(getDashboardPresence).toHaveBeenCalledTimes(2);
  });

  it("asks about no more boards than the server accepts", async () => {
    const ids = Array.from({ length: 80 }, (_, index) => `d${index}`);
    renderHook(() => useDashboardPresence(ids));

    await waitFor(() => expect(getDashboardPresence).toHaveBeenCalled());
    expect(getDashboardPresence.mock.calls[0][0]).toHaveLength(50);
  });

  it("leaves the last answer standing when a poll fails", async () => {
    const { result } = renderHook(() => useDashboardPresence(["d1"]));
    await waitFor(() => expect(result.current).not.toBeNull());

    getDashboardPresence.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(result.current!.get("d1")!.keys.has("k1")).toBe(true);
  });

  it("says nothing at all rather than something stale when the list empties", async () => {
    const { result, rerender } = renderHook(({ ids }) => useDashboardPresence(ids), {
      initialProps: { ids: ["d1"] },
    });
    await waitFor(() => expect(result.current).not.toBeNull());

    rerender({ ids: [] });

    expect(result.current).toBeNull();
  });
});
