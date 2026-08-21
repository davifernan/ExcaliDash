import { describe, expect, it, vi } from "vitest";
import {
  buildShareLinkToken,
  getDrawingAccess,
  hashShareLinkToken,
  parseShareLinkToken,
  shareLinkTokenMatches,
} from "./sharing";

describe("share link tokens", () => {
  it("creates a high-entropy URL-safe secret and compares only its hash", () => {
    const token = buildShareLinkToken();
    const other = buildShareLinkToken();
    const hash = hashShareLinkToken(token);

    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(shareLinkTokenMatches(token, hash)).toBe(true);
    expect(shareLinkTokenMatches(other, hash)).toBe(false);
    expect(shareLinkTokenMatches(token, "not-a-hash")).toBe(false);
  });

  it("rejects malformed URL values before authorization lookup", () => {
    expect(parseShareLinkToken(undefined)).toBeNull();
    expect(parseShareLinkToken("short")).toBeNull();
    expect(parseShareLinkToken(`${"a".repeat(31)}!`)).toBeNull();
    expect(parseShareLinkToken(` ${"a".repeat(32)} `)).toBe("a".repeat(32));
  });
});

describe("drawing account status", () => {
  it("denies an inactive owner even when the drawing also has an edit link", async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ isActive: false }),
      },
      drawing: {
        findUnique: vi.fn().mockResolvedValue({ userId: "inactive-owner" }),
      },
      drawingLinkShare: {
        findFirst: vi.fn().mockResolvedValue({ permission: "edit" }),
      },
    };

    await expect(
      getDrawingAccess({
        prisma: prisma as any,
        principal: { kind: "user", userId: "inactive-owner" },
        drawingId: "drawing-1",
      }),
    ).resolves.toBe("none");
    expect(prisma.drawing.findUnique).not.toHaveBeenCalled();
    expect(prisma.drawingLinkShare.findFirst).not.toHaveBeenCalled();
  });

  it("keeps the inactive bootstrap identity usable only with the explicit bypass", async () => {
    const prisma = {
      user: { findUnique: vi.fn() },
      drawing: {
        findUnique: vi.fn().mockResolvedValue({ userId: "bootstrap-admin" }),
      },
      drawingLinkShare: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    await expect(
      getDrawingAccess({
        prisma: prisma as any,
        principal: {
          kind: "user",
          userId: "bootstrap-admin",
          allowInactive: true,
        },
        drawingId: "drawing-1",
      }),
    ).resolves.toBe("owner");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
