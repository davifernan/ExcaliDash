import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupExpiredAuthData,
  startScheduledMaintenance,
} from "./scheduler";

const buildPrisma = () => ({
  refreshToken: { deleteMany: vi.fn().mockResolvedValue({ count: 4 }) },
  passwordResetToken: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
  auditLog: { deleteMany: vi.fn().mockResolvedValue({ count: 7 }) },
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("auth data retention", () => {
  it("keeps live and recent security records outside the delete filters", async () => {
    const prisma = buildPrisma();
    const now = new Date("2026-08-20T03:00:00.000Z");

    const counts = await cleanupExpiredAuthData({
      prisma: prisma as any,
      tokenRetentionDays: 30,
      auditRetentionDays: 365,
      now,
    });

    const tokenCutoff = new Date("2026-07-21T03:00:00.000Z");
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: tokenCutoff },
        OR: [{ revoked: true }, { expiresAt: { lt: now } }],
      },
    });
    expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: tokenCutoff },
        OR: [{ used: true }, { expiresAt: { lt: now } }],
      },
    });
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date("2025-08-20T03:00:00.000Z") } },
    });
    expect(counts).toEqual({ refreshTokens: 4, passwordResetTokens: 2, auditLogs: 7 });
  });

  it("runs cleanup through the shared maintenance scheduler without backups", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T03:00:00.000Z"));
    const prisma = buildPrisma();
    const stop = startScheduledMaintenance({
      backups: {
        prisma: prisma as any,
        databaseUrl: undefined,
        schedule: null,
        backupDir: "/not-used",
        retentionDays: 14,
      },
      authCleanup: {
        prisma: prisma as any,
        schedule: "* * * * * *",
        tokenRetentionDays: 30,
        auditRetentionDays: 365,
      },
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(stop).toEqual(expect.any(Function));
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledTimes(1);
    stop?.();
  });
});
