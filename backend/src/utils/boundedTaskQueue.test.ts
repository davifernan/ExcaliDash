import { describe, expect, it, vi } from "vitest";
import { BoundedTaskQueue, QueueAbortedError, QueueCapacityError } from "./boundedTaskQueue";

describe("BoundedTaskQueue", () => {
  it("refuses work beyond the running and waiting admission limits", async () => {
    const queue = new BoundedTaskQueue();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = queue.run({ concurrency: 1, maxWaiting: 1 }, () => gate);
    const second = queue.run({ concurrency: 1, maxWaiting: 1 }, async () => undefined);

    await expect(
      queue.run({ concurrency: 1, maxWaiting: 1 }, async () => undefined),
    ).rejects.toBeInstanceOf(QueueCapacityError);
    release();
    await Promise.all([first, second]);
  });

  it("removes an aborted request from the waiting queue", async () => {
    const queue = new BoundedTaskQueue();
    let release!: () => void;
    const first = queue.run(
      { concurrency: 1, maxWaiting: 1 },
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const controller = new AbortController();
    const waitingWork = vi.fn(async () => undefined);
    const waiting = queue.run(
      { concurrency: 1, maxWaiting: 1, signal: controller.signal },
      waitingWork,
    );
    controller.abort();

    await expect(waiting).rejects.toBeInstanceOf(QueueAbortedError);
    const replacement = queue.run({ concurrency: 1, maxWaiting: 1 }, async () => "accepted");
    release();
    await expect(replacement).resolves.toBe("accepted");
    await first;
    expect(waitingWork).not.toHaveBeenCalled();
  });
});
