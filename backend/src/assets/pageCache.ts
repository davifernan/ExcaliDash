/**
 * Rendered pages, kept only as long as they are worth keeping.
 *
 * A page costs about a quarter of a second to produce, so these are a cache
 * rather than data: the only durable thing is the original document. That is
 * what makes the disk cost of a document independent of how many pages it has.
 *
 * Three rules follow from running on a small machine:
 *
 * One render at a time, and only one per page — ten people opening the same
 * document at once wait for one render, not ten.
 *
 * Never start a render that could fill the disk. A machine that cannot write is
 * worse than a document that is slow to open.
 *
 * When the cache is over budget, drop the oldest pages. They come back.
 */
import { readdir, readFile, stat, statfs, utimes } from "node:fs/promises";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { Readable } from "node:stream";
import { join } from "node:path";
import {
  pageCacheKey,
  removeStored,
  resolveStoragePath,
  shouldCompress,
  storeStream,
} from "./assetStorage";
import { RENDERER_VERSION, renderPage } from "./pdfRenderer";

export type CachedPage = {
  body: Buffer;
  mimeType: string;
  contentEncoding: string | null;
};

export type PageCacheDeps = {
  storageDir: string;
  cacheBudgetBytes: number;
  minFreeDiskPercent: number;
  /** Swappable so tests do not need poppler. */
  render?: typeof renderPage;
  now?: () => number;
};

const EXTENSION: Record<string, string> = {
  "image/svg+xml": ".svg.br",
  "image/png": ".png",
};
const MIME_BY_EXTENSION: Record<string, string> = {
  ".svg.br": "image/svg+xml",
  ".png": "image/png",
};

export class DiskFullError extends Error {
  constructor(freePercent: number, needPercent: number) {
    super(
      `Not enough free disk to render this page: ${freePercent.toFixed(1)}% free, ` +
      `${needPercent}% required. Free some space and try again.`,
    );
    this.name = "DiskFullError";
  }
}

/** Free space as a percentage, or null when the filesystem cannot say. */
export async function freeDiskPercent(path: string): Promise<number | null> {
  try {
    const fs = await statfs(path);
    const total = Number(fs.blocks) * Number(fs.bsize);
    if (!total) return null;
    return (Number(fs.bavail) * Number(fs.bsize) * 100) / total;
  } catch {
    return null;
  }
}

/** Renders in flight, so concurrent readers of the same page share one. */
const inFlight = new Map<string, Promise<CachedPage>>();

export async function getPage(
  deps: PageCacheDeps,
  asset: { id: string; blob: { storageKey: string } },
  page: number,
): Promise<CachedPage> {
  const cached = await readCached(deps.storageDir, asset.id, page);
  if (cached) return cached;

  const key = `${asset.id}:${page}:${RENDERER_VERSION}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const work = produce(deps, asset, page).finally(() => inFlight.delete(key));
  inFlight.set(key, work);
  return work;
}

async function produce(
  deps: PageCacheDeps,
  asset: { id: string; blob: { storageKey: string } },
  page: number,
): Promise<CachedPage> {
  const free = await freeDiskPercent(deps.storageDir);
  if (free !== null && free < deps.minFreeDiskPercent) {
    // Try to make room first; only give up if that was not enough.
    await evictToBudget(deps);
    const after = await freeDiskPercent(deps.storageDir);
    if (after !== null && after < deps.minFreeDiskPercent) {
      throw new DiskFullError(after, deps.minFreeDiskPercent);
    }
  }

  const render = deps.render ?? renderPage;
  const source = resolveStoragePath(deps.storageDir, asset.blob.storageKey);
  const rendered = await render(source, page);

  const compress = shouldCompress(rendered.mimeType);
  const body = compress
    ? brotliCompressSync(rendered.body, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
      })
    : rendered.body;

  const extension = EXTENSION[rendered.mimeType] ?? ".bin";
  const key = pageCacheKey(asset.id, RENDERER_VERSION, page, extension);
  // Written through the same path as everything else, so it lands atomically
  // and a reader never sees half a page. The already-compressed bytes go in
  // as-is; compressing twice would only waste time.
  await storeStream(deps.storageDir, key, Readable.from([body]), body.length + 1);

  await evictToBudget(deps);

  return {
    body,
    mimeType: rendered.mimeType,
    contentEncoding: compress ? "br" : null,
  };
}

/** A page already on disk, if it is there for this renderer version. */
async function readCached(
  storageDir: string,
  assetId: string,
  page: number,
): Promise<CachedPage | null> {
  for (const [extension, mimeType] of Object.entries(MIME_BY_EXTENSION)) {
    const key = pageCacheKey(assetId, RENDERER_VERSION, page, extension);
    try {
      const path = resolveStoragePath(storageDir, key);
      const body = await readFile(path);
      // Touch it so eviction can tell recently used pages from forgotten ones,
      // without a database write on every read.
      const now = new Date();
      void utimes(path, now, now).catch(() => {});
      return {
        body,
        mimeType,
        contentEncoding: extension.endsWith(".br") ? "br" : null,
      };
    } catch {
      // Not this format; try the next.
    }
  }
  return null;
}

type CacheEntry = { key: string; bytes: number; usedAt: number };

/** Every cached page, oldest use first. */
export async function listCached(storageDir: string): Promise<CacheEntry[]> {
  const root = resolveStoragePath(storageDir, "cache");
  const entries: CacheEntry[] = [];

  const walk = async (dir: string, prefix: string) => {
    let items;
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const full = join(dir, item.name);
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        await walk(full, rel);
        continue;
      }
      try {
        const info = await stat(full);
        entries.push({ key: join("cache", rel), bytes: info.size, usedAt: info.atimeMs });
      } catch {
        // Removed underneath us; nothing to account for.
      }
    }
  };

  await walk(root, "");
  return entries.sort((a, b) => a.usedAt - b.usedAt);
}

/**
 * Drop the least recently used pages until the cache is back under budget.
 *
 * Returns how many bytes were freed, so a caller can tell whether it is worth
 * trying again.
 */
export async function evictToBudget(deps: PageCacheDeps): Promise<number> {
  const entries = await listCached(deps.storageDir);
  let total = entries.reduce((sum, e) => sum + e.bytes, 0);
  if (total <= deps.cacheBudgetBytes) return 0;

  // Go somewhat under the ceiling rather than exactly to it, so the next page
  // written does not immediately start another sweep.
  const target = deps.cacheBudgetBytes * 0.9;
  let freed = 0;
  for (const entry of entries) {
    if (total <= target) break;
    await removeStored(deps.storageDir, entry.key);
    total -= entry.bytes;
    freed += entry.bytes;
  }
  return freed;
}
