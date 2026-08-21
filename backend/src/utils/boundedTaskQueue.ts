export class QueueCapacityError extends Error {
  constructor(message = "Server work queue is full") {
    super(message);
    this.name = "QueueCapacityError";
  }
}

export class QueueAbortedError extends Error {
  constructor() {
    super("Queued work was cancelled");
    this.name = "QueueAbortedError";
  }
}

type WaitingJob<T> = {
  concurrency: number;
  work: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

/** A small FIFO admission queue for expensive child-process work. */
export class BoundedTaskQueue {
  private active = 0;
  private readonly waiting: Array<WaitingJob<unknown>> = [];

  /**
   * How much work is in hand right now.
   *
   * Admission is decided inside `run`, so nothing outside needs this to make a
   * decision -- but plenty of things need to observe it. A queue that is
   * permanently full is the difference between "slow" and "broken", and
   * something has to be able to say which one is happening.
   */
  get depth(): { running: number; waiting: number } {
    return { running: this.active, waiting: this.waiting.length };
  }

  run<T>(
    options: { concurrency: number; maxWaiting: number; signal?: AbortSignal },
    work: () => Promise<T>,
  ): Promise<T> {
    const concurrency = Math.max(1, Math.floor(options.concurrency));
    const maxWaiting = Math.max(0, Math.floor(options.maxWaiting));
    if (options.signal?.aborted) return Promise.reject(new QueueAbortedError());
    if (this.active >= concurrency && this.waiting.length >= maxWaiting) {
      return Promise.reject(new QueueCapacityError());
    }

    return new Promise<T>((resolve, reject) => {
      const job: WaitingJob<T> = {
        concurrency,
        work,
        resolve,
        reject,
        signal: options.signal,
      };
      if (options.signal) {
        job.abort = () => {
          const index = this.waiting.indexOf(job as WaitingJob<unknown>);
          if (index < 0) return;
          this.waiting.splice(index, 1);
          reject(new QueueAbortedError());
          this.drain();
        };
        options.signal.addEventListener("abort", job.abort, { once: true });
      }
      this.waiting.push(job as WaitingJob<unknown>);
      this.drain();
    });
  }

  private drain(): void {
    while (this.waiting.length > 0) {
      const next = this.waiting[0];
      if (this.active >= next.concurrency) return;
      this.waiting.shift();
      if (next.abort) next.signal?.removeEventListener("abort", next.abort);
      if (next.signal?.aborted) {
        next.reject(new QueueAbortedError());
        continue;
      }
      this.active += 1;
      void next
        .work()
        .then(next.resolve, next.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}
