import { describe, expect, it, vi } from "vitest";
import { ActiveAccountCache } from "./activeAccountCache";

describe("ActiveAccountCache", () => {
  it("coalesces an event flood into one account lookup", async () => {
    const load = vi.fn(async () => true);
    const cache = new ActiveAccountCache(load, 250);

    await expect(
      Promise.all(Array.from({ length: 190 }, () => cache.get("user-1"))),
    ).resolves.toEqual(Array(190).fill(true));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("re-reads immediately after explicit invalidation", async () => {
    const load = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const cache = new ActiveAccountCache(load, 250);

    await expect(cache.get("user-1")).resolves.toBe(true);
    cache.invalidate("user-1");
    await expect(cache.get("user-1")).resolves.toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("bounds identities even when none have expired", async () => {
    const load = vi.fn(async () => true);
    const cache = new ActiveAccountCache(load, 250, () => 0, 2);

    await cache.get("user-1");
    await cache.get("user-2");
    await cache.get("user-3");
    await cache.get("user-1");

    expect(load).toHaveBeenCalledTimes(4);
  });

  it("removes expired identities from other users under churn", async () => {
    let now = 0;
    const load = vi.fn(async () => true);
    const cache = new ActiveAccountCache(load, 250, () => now, 2);

    await cache.get("user-1");
    await cache.get("user-2");
    now = 251;
    await cache.get("user-3");
    await cache.get("user-2");

    expect(load).toHaveBeenCalledTimes(4);
  });
});
