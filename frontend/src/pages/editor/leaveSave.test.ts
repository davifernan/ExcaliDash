import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import debounce from "lodash/debounce";

/**
 * Leaving must not throw away the last second of work.
 *
 * Saving is debounced by a second. Leaving used to cancel whatever was still
 * pending, so a change made just before closing was gone when the board was
 * opened again — and the live socket does not help, because it broadcasts
 * rather than persists.
 */
describe("a pending save when the editor goes away", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is run rather than dropped", () => {
    const save = vi.fn();
    const debounced = debounce(save, 1000);

    debounced("board-1", ["element"]);
    // Leaving before the second is up.
    debounced.flush();

    expect(save).toHaveBeenCalledWith("board-1", ["element"]);
  });

  it("was lost with the old behaviour, which is what this guards", () => {
    const save = vi.fn();
    const debounced = debounce(save, 1000);

    debounced("board-1", ["element"]);
    debounced.cancel();
    vi.advanceTimersByTime(5000);

    expect(save).not.toHaveBeenCalled();
  });

  it("runs only once even when flushed twice", () => {
    const save = vi.fn();
    const debounced = debounce(save, 1000);

    debounced("board-1", ["element"]);
    debounced.flush();
    debounced.flush();

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there was nothing pending", () => {
    const save = vi.fn();
    const debounced = debounce(save, 1000);

    debounced.flush();

    expect(save).not.toHaveBeenCalled();
  });
});

/**
 * Closing the tab is the harder case: a normal request goes away with the page.
 */
describe("the last-moment save when the page is closing", () => {
  const buildRequest = (
    drawingId: string | null,
    elements: readonly unknown[] | null,
    lastPersisted: readonly unknown[] | null,
  ) => {
    if (!drawingId || !elements) return null;
    if (lastPersisted === elements) return null;
    return {
      url: `/api/drawings/${drawingId}`,
      method: "PUT",
      keepalive: true,
      credentials: "include",
    };
  };

  it("is sent with keepalive, so the browser finishes it after the page is gone", () => {
    const request = buildRequest("board-1", ["changed"], ["older"]);
    expect(request?.keepalive).toBe(true);
    expect(request?.method).toBe("PUT");
  });

  it("carries the session, or the server would refuse it", () => {
    expect(buildRequest("board-1", ["changed"], ["older"])?.credentials).toBe("include");
  });

  it("is skipped when nothing changed since the last save", () => {
    const same = ["unchanged"];
    expect(buildRequest("board-1", same, same)).toBeNull();
  });

  it("is skipped when there is no board open", () => {
    expect(buildRequest(null, ["changed"], null)).toBeNull();
  });
});
