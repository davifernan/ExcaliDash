import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const readRootFile = (name: string) => readFile(resolve(root, name), "utf8");

describe("production operations defaults", () => {
  it("enables bounded scheduled backups on persistent host storage", async () => {
    const compose = await readRootFile("docker-compose.prod.yml");
    expect(compose).toMatch(/BACKUP_SCHEDULE=.*0 0 3 \* \* \*/);
    expect(compose).toMatch(/BACKUP_MAX_COUNT=.*7/);
    expect(compose).toMatch(/BACKUP_MAX_TOTAL_MB=.*30720/);
    expect(compose).toMatch(/BACKUP_MIN_FREE_DISK_PERCENT=.*20/);
    expect(compose).toMatch(/BACKUP_HOST_DIR[^\n]*:\/app\/backups/);
  });

  it("rotates container logs in every compose file", async () => {
    const names = [
      "docker-compose.yml",
      "docker-compose.prod.yml",
      "docker-compose.lab.yml",
      "docker-compose.local-multi.yml",
      "docker-compose.oidc.yml",
      "docker-compose.pg-test.yml",
    ];
    for (const name of names) {
      const compose = await readRootFile(name);
      expect(compose, name).toContain("max-size: \"10m\"");
      expect(compose, name).toContain("max-file: \"3\"");
    }
  });

  it("requires an explicit immutable production image tag", async () => {
    const compose = await readRootFile("docker-compose.prod.yml");
    expect(compose).not.toMatch(/excalidash-(?:backend|frontend):latest/);
    expect(compose).toMatch(/EXCALIDASH_IMAGE_TAG:\?[^}]+/);
  });

  it("ships a disaster restore and interrupted-upgrade runbook", async () => {
    const restore = await readRootFile("docs/RESTORE.md");
    expect(restore).toContain("database.sqlite");
    expect(restore).toContain("assets/originals");
    expect(restore).toContain(".jwt_secret");
    expect(restore).toContain(".csrf_secret");
    expect(restore).toMatch(/Expected result:/g);
    expect(restore).toContain(".migration-lock");
    expect(restore).toContain("prisma migrate resolve");
  });
});
