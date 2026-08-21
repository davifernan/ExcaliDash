/**
 * Who is connected to which board, right now.
 *
 * This lives in its own module so that the HTTP side can read it without
 * importing the socket server — and so the socket server keeps writing to one
 * place instead of two. Nothing here is persisted: presence is a fact about
 * open connections, and when the process restarts there is nothing to remember.
 */
export type PresenceKind = "owner" | "member" | "guest";

export type PresenceEntry = {
  presenceId: string;
  accountId: string | null;
  name: string;
  initials: string;
  color: string;
  kind: PresenceKind;
  isActive: boolean;
};

/**
 * What a presence looks like to the people sharing the board.
 *
 * The account id stays behind: everyone in the room gets this, and a share link
 * puts anonymous visitors in the room too. An account id is a handle to a real
 * row, so handing it out lets a visitor recognise the same person on any other
 * board they are ever given a link to. Nothing on the client reads it — the one
 * place that needs to match presence against a member list does it with a
 * scoped subject key instead (see authz/subjectKey).
 */
export type PublicPresenceEntry = Omit<PresenceEntry, "accountId">;

export const toPublicPresence = ({
  accountId: _accountId,
  ...rest
}: PresenceEntry): PublicPresenceEntry => rest;

export type PresenceSummaryMember = {
  accountId: string;
  name: string;
  initials: string;
  color: string;
  kind: Exclude<PresenceKind, "guest">;
};

export type PresenceSummary = {
  members: PresenceSummaryMember[];
  guestCount: number;
};

export class PresenceRegistry {
  private readonly byDrawing = new Map<string, Map<string, PresenceEntry>>();

  join(drawingId: string, entry: PresenceEntry): void {
    const entries = this.byDrawing.get(drawingId) || new Map<string, PresenceEntry>();
    entries.set(entry.presenceId, entry);
    this.byDrawing.set(drawingId, entries);
  }

  leave(drawingId: string, presenceId: string): void {
    const entries = this.byDrawing.get(drawingId);
    if (!entries) return;
    entries.delete(presenceId);
    if (entries.size === 0) this.byDrawing.delete(drawingId);
  }

  get(drawingId: string, presenceId: string): PresenceEntry | null {
    return this.byDrawing.get(drawingId)?.get(presenceId) || null;
  }

  setActive(drawingId: string, presenceId: string, isActive: boolean): boolean {
    const entry = this.byDrawing.get(drawingId)?.get(presenceId);
    if (!entry || entry.isActive === isActive) return false;
    entry.isActive = isActive;
    return true;
  }

  list(drawingId: string): PresenceEntry[] {
    return Array.from(this.byDrawing.get(drawingId)?.values() || []);
  }

  /** The same list, with what the room has no business knowing removed. */
  listPublic(drawingId: string): PublicPresenceEntry[] {
    return this.list(drawingId).map(toPublicPresence);
  }

  occupiedDrawingIds(): string[] {
    return Array.from(this.byDrawing.keys());
  }

  /**
   * What a board looks like from the outside: one entry per person rather than
   * per connection, because two tabs are still one colleague, and guests as a
   * number, because an unauthenticated visitor cannot be told apart from the
   * same visitor reconnecting.
   */
  summarise(drawingId: string): PresenceSummary {
    const members = new Map<string, PresenceSummaryMember>();
    let guestCount = 0;
    for (const entry of this.byDrawing.get(drawingId)?.values() || []) {
      if (entry.kind === "guest" || !entry.accountId) {
        guestCount += 1;
        continue;
      }
      const existing = members.get(entry.accountId);
      if (!existing) {
        members.set(entry.accountId, {
          accountId: entry.accountId,
          name: entry.name,
          initials: entry.initials,
          color: entry.color,
          kind: entry.kind,
        });
        continue;
      }
      if (entry.kind === "owner") existing.kind = "owner";
    }
    return {
      members: Array.from(members.values()).sort((a, b) => a.name.localeCompare(b.name)),
      guestCount,
    };
  }
}
