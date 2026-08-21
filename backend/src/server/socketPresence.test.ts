import { describe, expect, it } from "vitest";
import { derivePresenceColor, deriveGuestName, toPresenceInitials } from "./socketPresence";

describe("presence identity", () => {
  it("gives one account the same colour every time", () => {
    expect(derivePresenceColor("user-42")).toBe(derivePresenceColor("user-42"));
  });

  it("matches the palette the frontend derives for the same account", () => {
    // frontend/src/pages/editor/shared.ts getColorFromString("user-42")
    const COLORS = [
      "#ef4444",
      "#f97316",
      "#f59e0b",
      "#84cc16",
      "#22c55e",
      "#10b981",
      "#14b8a6",
      "#06b6d4",
      "#0ea5e9",
      "#3b82f6",
      "#6366f1",
      "#8b5cf6",
      "#a855f7",
      "#d946ef",
      "#ec4899",
      "#f43f5e",
    ];
    const expected = (str: string) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
      return COLORS[Math.abs(hash) % COLORS.length];
    };
    for (const seed of ["user-42", "davi", "a", "", "9f8c1b2e-0000-4000-8000-abcdefabcdef"]) {
      expect(derivePresenceColor(seed)).toBe(expected(seed));
    }
  });

  it("names guests itself, stably per seed", () => {
    expect(deriveGuestName("socket-1")).toBe(deriveGuestName("socket-1"));
    expect(deriveGuestName("socket-1")).not.toBe(deriveGuestName("socket-2"));
  });

  it("never lets a guest arrive under a name they chose", () => {
    // Whatever the browser sends, the name comes from the seed alone.
    const names = new Set(
      Array.from({ length: 200 }, (_, index) => deriveGuestName(`socket-${index}`)),
    );
    expect(names.size).toBeGreaterThan(20);
    for (const name of names) {
      expect(name).not.toContain("Davi");
      expect(name.trim()).toBe(name);
      expect(name.length).toBeLessThan(40);
    }
  });

  it("still derives initials from the name it decided on", () => {
    expect(toPresenceInitials(deriveGuestName("socket-1"))).toMatch(/^[A-Z]{2}$/);
  });
});
