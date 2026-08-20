/**
 * Where uploaded documents live on disk.
 *
 * Until now this instance had no file storage at all: without S3 the
 * `/api/files` route answers 501 and images are kept as data URLs inside the
 * drawing JSON. That is workable for a screenshot and unworkable for a PDF,
 * whose rendered pages would otherwise be copied into every save and every
 * snapshot.
 *
 * Documents therefore go to disk, and only an id for them goes into the board.
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

export type StoredFile = {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
};

export class AssetTooLargeError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`File exceeds the ${Math.round(limitBytes / 1024 / 1024)} MB upload limit.`);
    this.name = "AssetTooLargeError";
  }
}

/**
 * Turn a storage key into an absolute path, refusing anything that would leave
 * the storage directory.
 *
 * Keys are generated here and never come from a request, but this is the last
 * gate before a filesystem call — a bug upstream should surface as an error
 * rather than as a read of somewhere else on the disk.
 */
export function resolveStoragePath(root: string, storageKey: string): string {
  const base = resolve(root);
  const full = resolve(base, storageKey);
  if (full !== base && !full.startsWith(base + sep)) {
    throw new Error(`Storage key "${storageKey}" resolves outside the asset directory.`);
  }
  return full;
}

/**
 * Two levels of hex directories keep any single directory from collecting
 * hundreds of thousands of entries, which some filesystems handle badly.
 *
 * Keyed by blob rather than by asset: the same document uploaded to three
 * boards is one file here and three assets in the database.
 */
export function originalKey(blobId: string): string {
  const safe = blobId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (safe.length < 4) throw new Error("Blob id is too short to derive a storage key.");
  return join("originals", safe.slice(0, 2), safe.slice(2, 4), safe);
}

/** Cache keys carry the renderer version so an upgrade cannot serve stale output. */
export function pageCacheKey(
  assetId: string,
  rendererVersion: string,
  page: number,
  extension: string,
): string {
  const safeAsset = assetId.replace(/[^a-zA-Z0-9_-]/g, "");
  const safeVersion = rendererVersion.replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!safeAsset) throw new Error("Asset id must not be empty.");
  if (!safeVersion) throw new Error("Renderer version must not be empty.");
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(`Page must be a positive integer, got ${page}.`);
  }
  const safeExt = extension.replace(/[^a-zA-Z0-9.]/g, "");
  return join("cache", safeAsset, safeVersion, `${String(page).padStart(6, "0")}${safeExt}`);
}

/**
 * Stream an upload to disk, hashing as it goes, and refuse it the moment it
 * grows past the limit.
 *
 * Checking Content-Length would be checking a claim; this counts the bytes that
 * actually arrive. The partial file is removed on every failure path, so a
 * refused or interrupted upload leaves nothing behind.
 */
export async function storeStream(
  root: string,
  storageKey: string,
  source: Readable,
  limitBytes: number,
): Promise<StoredFile> {
  const target = resolveStoragePath(root, storageKey);
  const stagingDir = resolveStoragePath(root, "staging");
  const staging = join(
    stagingDir,
    `${Date.now()}-${Math.random().toString(36).slice(2)}.part`,
  );

  await mkdir(stagingDir, { recursive: true });
  await mkdir(dirname(target), { recursive: true });

  const hash = createHash("sha256");
  let sizeBytes = 0;
  let tooLarge = false;

  try {
    await pipeline(
      source,
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          sizeBytes += chunk.length;
          if (sizeBytes > limitBytes) {
            tooLarge = true;
            throw new AssetTooLargeError(limitBytes);
          }
          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(staging),
    );
  } catch (err) {
    await rm(staging, { force: true });
    if (tooLarge) throw new AssetTooLargeError(limitBytes);
    throw err;
  }

  // Staging and target share a filesystem, so the rename is atomic: a reader
  // sees either no file or the whole file, never a half-written one.
  try {
    await rename(staging, target);
  } catch (err) {
    await rm(staging, { force: true });
    throw err;
  }

  return { storageKey, sizeBytes, sha256: hash.digest("hex") };
}

/** Size of a stored file, or null when it is not there. */
export async function storedSize(root: string, storageKey: string): Promise<number | null> {
  try {
    const info = await stat(resolveStoragePath(root, storageKey));
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

/** Remove a stored file. Missing counts as success — the goal is that it is gone. */
export async function removeStored(root: string, storageKey: string): Promise<void> {
  await rm(resolveStoragePath(root, storageKey), { force: true });
}
