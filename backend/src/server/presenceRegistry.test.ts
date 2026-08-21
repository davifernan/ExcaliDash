import { describe, expect, it } from "vitest";
import { PresenceRegistry, type PresenceEntry } from "./presenceRegistry";

const entry = (overrides: Partial<PresenceEntry> = {}): PresenceEntry => ({
  presenceId: "s1",
  accountId: "u1",
  name: "Davi",
  initials: "DA",
  color: "#3b82f6",
  kind: "member",
  isActive: true,
  selectedElementIds: {},
  ...overrides,
});

describe("presence registry", () => {
  it("counts two tabs of one person as one person", () => {
    const registry = new PresenceRegistry();
    registry.join("d1", entry({ presenceId: "s1" }));
    registry.join("d1", entry({ presenceId: "s2", isActive: false }));

    const summary = registry.summarise("d1");
    expect(summary.members).toHaveLength(1);
    expect(summary.members[0].accountId).toBe("u1");
  });

  it("counts guests instead of naming them", () => {
    const registry = new PresenceRegistry();
    registry.join(
      "d1",
      entry({ presenceId: "g1", accountId: null, kind: "guest", name: "Guest A7" }),
    );
    registry.join(
      "d1",
      entry({ presenceId: "g2", accountId: null, kind: "guest", name: "Guest B3" }),
    );

    const summary = registry.summarise("d1");
    expect(summary.members).toHaveLength(0);
    expect(summary.guestCount).toBe(2);
    expect(JSON.stringify(summary)).not.toContain("Guest");
  });

  it("keeps the owner badge when the same person also has a plain tab open", () => {
    const registry = new PresenceRegistry();
    registry.join("d1", entry({ presenceId: "s1", kind: "member" }));
    registry.join("d1", entry({ presenceId: "s2", kind: "owner" }));

    expect(registry.summarise("d1").members[0].kind).toBe("owner");
  });

  it("forgets a board once the last connection goes", () => {
    const registry = new PresenceRegistry();
    registry.join("d1", entry());
    registry.leave("d1", "s1");

    expect(registry.occupiedDrawingIds()).toEqual([]);
    expect(registry.list("d1")).toEqual([]);
  });

  it("reports whether an activity flag actually changed anything", () => {
    const registry = new PresenceRegistry();
    registry.join("d1", entry({ isActive: true }));

    expect(registry.setActive("d1", "s1", true)).toBe(false);
    expect(registry.setActive("d1", "s1", false)).toBe(true);
    expect(registry.setActive("d1", "missing", false)).toBe(false);
  });
});
