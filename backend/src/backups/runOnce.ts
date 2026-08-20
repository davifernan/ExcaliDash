import { config } from "../config";
import { prisma } from "../db/prisma";
import { createSqliteBackup } from "./scheduler";

const main = async () => {
  const target = await createSqliteBackup({
    prisma,
    databaseUrl: config.databaseUrl,
    backupDir: config.backups.dir,
    assetStorageDir: config.assets.storageDir,
    retentionDays: config.backups.retentionDays,
  });
  if (!target) throw new Error("One-off backups require a SQLite file: DATABASE_URL.");
  console.log(`[backup] One-off backup completed: ${target}`);
};

void main()
  .catch((error) => {
    console.error("[backup] One-off backup failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
