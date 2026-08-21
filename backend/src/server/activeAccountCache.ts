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
  ) {}

  get(userId: string): Promise<boolean> {
    const existing = this.entries.get(userId);
    if (existing && existing.expiresAt > this.now()) return existing.value;

    const value = this.load(userId).catch((error) => {
      if (this.entries.get(userId)?.value === value) this.entries.delete(userId);
      throw error;
    });
    this.entries.set(userId, { expiresAt: this.now() + this.ttlMs, value });
    return value;
  }

  invalidate(userId: string): void {
    this.entries.delete(userId);
  }
}
