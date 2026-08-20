import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import {
  cleanupExpiredAuthData,
  createSqliteBackup,
  startScheduledMaintenance,
} from "./scheduler";

const Database = require("better-sqlite3") as any;
const tempDirs: string[] = [];

const buildPrisma = () => ({
  refreshToken: { deleteMany: vi.fn().mockResolvedValue({ count: 4 }) },
  passwordResetToken: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
  auditLog: { deleteMany: vi.fn().mockResolvedValue({ count: 7 }) },
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("scheduled backups", () => {
  it("archives the SQLite copy and referenced originals without the cache", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "scheduled-backup-"));
    tempDirs.push(root);
    const databasePath = join(root, "source.db");
    const backupDir = join(root, "backups");
    const assetStorageDir = join(root, "assets");
    const storageKey = "originals/ab/cd/blob-id";
    const original = Buffer.from("original bytes");
    await fs.mkdir(join(assetStorageDir, "originals/ab/cd"), { recursive: true });
    await fs.mkdir(join(assetStorageDir, "cache/asset"), { recursive: true });
    await fs.writeFile(join(assetStorageDir, storageKey), original);
    await fs.writeFile(join(assetStorageDir, "cache/asset/page.svg"), "discard me");
    await fs.mkdir(backupDir);
    const expiredBackup = join(backupDir, "excalidash-sqlite-expired.db");
    const stalePartial = join(backupDir, ".excalidash-stale.sqlite.part");
    await fs.writeFile(expiredBackup, "old");
    await fs.writeFile(stalePartial, "interrupted");
    const oldBackupTime = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const oldPartialTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await fs.utimes(expiredBackup, oldBackupTime, oldBackupTime);
    await fs.utimes(stalePartial, oldPartialTime, oldPartialTime);
    const db = new Database(databasePath);
    db.exec('CREATE TABLE "StoredBlob" ("storageKey" TEXT NOT NULL, "state" TEXT NOT NULL)');
    db.prepare('INSERT INTO "StoredBlob" ("storageKey", "state") VALUES (?, ?)').run(storageKey, "READY");
    db.close();

    const target = await createSqliteBackup({
      prisma: { $executeRawUnsafe: vi.fn().mockResolvedValue(undefined) } as any,
      databaseUrl: `file:${databasePath}`,
      backupDir,
      assetStorageDir,
      retentionDays: 14,
    });
    const archive = await JSZip.loadAsync(await fs.readFile(target!));
    expect(archive.file("database.sqlite")).toBeTruthy();
    expect(await archive.file(`assets/${storageKey}`)!.async("nodebuffer")).toEqual(original);
    expect(Object.keys(archive.files).some((name) => name.includes("/cache/"))).toBe(false);
    await expect(fs.stat(expiredBackup)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(stalePartial)).rejects.toMatchObject({ code: "ENOENT" });
  });
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
        assetStorageDir: "/not-used",
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
