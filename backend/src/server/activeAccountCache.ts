/**
 * A deliberately tiny cache for the one account-status read performed by
 * every live collaboration event. Access-control rows are not cached here.
 */
export class ActiveAccountCache {
  private readonly entries = new Map<string, { expiresAt: number; value: Promise<boolean> }>();

  constructor(
    private readonly load: (userId: string) => Promise<boolean>,
    private readonly ttlMs = 250,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 10_000,
  ) {}

  get(userId: string): Promise<boolean> {
    const now = this.now();
    const existing = this.entries.get(userId);
    if (existing && existing.expiresAt > now) return existing.value;

    // A short TTL limits staleness, not memory. Under sustained churn, remove
    // every expired identity and then evict oldest entries until the hard cap
    // has room for this one.
    if (this.entries.size >= this.maxEntries) {
      for (const [id, entry] of this.entries) {
        if (entry.expiresAt <= now) this.entries.delete(id);
      }
      while (this.entries.size >= Math.max(1, this.maxEntries)) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.entries.delete(oldest);
      }
    }

    const value = this.load(userId).catch((error) => {
      if (this.entries.get(userId)?.value === value) this.entries.delete(userId);
      throw error;
    });
    this.entries.set(userId, { expiresAt: now + this.ttlMs, value });
    return value;
  }

  invalidate(userId: string): void {
    this.entries.delete(userId);
  }
}
