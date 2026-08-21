import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { removeStored } from "../assets/assetStorage";
import { storeBlob } from "../assets/assetService";
import { BoundedTaskQueue } from "../utils/boundedTaskQueue";
import type { LinkPreviewConfig } from "../config";
import { sanitizePreviewImage, type ImageLimits } from "./imageProcessor";
import { extractLinkMetadata } from "./metadata";
import { fetchPreviewResource, PreviewFetchError, type PreviewNetworkLimits } from "./network";

type ServiceDeps = {
  prisma: any;
  storageDir: string;
  config: LinkPreviewConfig;
  now?: () => number;
  fetchResource?: typeof fetchPreviewResource;
  sanitizeImage?: typeof sanitizePreviewImage;
};

export class LinkPreviewBusyError extends Error {
  constructor() {
    super("Too many link previews are already being fetched.");
    this.name = "LinkPreviewBusyError";
  }
}

export type LinkPreviewResult = {
  id: string;
  status: "READY" | "NEGATIVE";
  failureCode: string | null;
  requestedUrl: string;
  resolvedUrl: string | null;
  title: string | null;
  description: string | null;
  imageBlobId: string | null;
  faviconBlobId: string | null;
};

function canonicalUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PreviewFetchError("INVALID_URL", "A valid absolute URL is required.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new PreviewFetchError(
      "INVALID_URL",
      "Only HTTP and HTTPS URLs without credentials are supported.",
    );
  }
  url.hash = "";
  return url;
}

const cacheKeyFor = (url: URL): string => createHash("sha256").update(url.href).digest("hex");

function networkLimits(config: LinkPreviewConfig, kind: "page" | "image"): PreviewNetworkLimits {
  return {
    dnsTimeoutMs: config.dnsTimeoutMs,
    connectTimeoutMs: config.connectTimeoutMs,
    totalTimeoutMs: config.totalTimeoutMs,
    maxRedirects: config.maxRedirects,
    maxWireBytes: kind === "page" ? config.maxPageWireBytes : config.maxImageWireBytes,
    maxDecodedBytes: kind === "page" ? config.maxPageDecodedBytes : config.maxImageDecodedBytes,
  };
}

function imageLimits(config: LinkPreviewConfig, favicon: boolean): ImageLimits {
  return {
    maxPixels: config.maxImagePixels,
    maxDimension: favicon ? config.maxFaviconDimension : config.maxImageDimension,
    maxOutputBytes: config.maxSanitizedImageBytes,
    timeoutMs: config.imageProcessTimeoutMs,
  };
}

function publicResult(row: any): LinkPreviewResult {
  return {
    id: row.id,
    status: row.status,
    failureCode: row.failureCode ?? null,
    requestedUrl: row.requestedUrl,
    resolvedUrl: row.resolvedUrl ?? null,
    title: row.title ?? null,
    description: row.description ?? null,
    imageBlobId: row.imageBlobId ?? null,
    faviconBlobId: row.faviconBlobId ?? null,
  };
}

async function storeSanitizedImage(deps: ServiceDeps, bytes: Buffer) {
  const { blob } = await storeBlob(
    { prisma: deps.prisma, storageDir: deps.storageDir },
    {
      source: Readable.from([bytes]),
      limitBytes: deps.config.maxSanitizedImageBytes,
    },
  );
  return blob;
}

async function mirrorImage(
  deps: ServiceDeps,
  url: URL | null,
  favicon: boolean,
): Promise<any | null> {
  if (!url) return null;
  try {
    const fetched = await (deps.fetchResource ?? fetchPreviewResource)(
      url,
      "image",
      networkLimits(deps.config, "image"),
    );
    const clean = await (deps.sanitizeImage ?? sanitizePreviewImage)(
      fetched.body,
      imageLimits(deps.config, favicon),
    );
    return await storeSanitizedImage(deps, clean);
  } catch {
    // A card without art is preferable to disclosing the foreign URL or
    // serving bytes that did not survive every image check.
    return null;
  }
}

async function removeUnusedBlob(deps: Pick<ServiceDeps, "prisma" | "storageDir">, blobId: string) {
  const [assets, previews] = await Promise.all([
    deps.prisma.asset.count({ where: { blobId } }),
    deps.prisma.linkPreview.count({
      where: { OR: [{ imageBlobId: blobId }, { faviconBlobId: blobId }] },
    }),
  ]);
  if (assets + previews > 0) return false;
  const blob = await deps.prisma.storedBlob.findUnique({ where: { id: blobId } });
  if (!blob) return false;
  await removeStored(deps.storageDir, blob.storageKey);
  await deps.prisma.storedBlob.delete({ where: { id: blobId } });
  return true;
}

async function discardRow(deps: ServiceDeps, row: any): Promise<void> {
  await deps.prisma.linkPreview.deleteMany({ where: { id: row.id } });
  const blobIds = [...new Set([row.imageBlobId, row.faviconBlobId].filter(Boolean))] as string[];
  for (const blobId of blobIds) await removeUnusedBlob(deps, blobId);
}

async function freshCached(deps: ServiceDeps, cacheKey: string): Promise<any | null> {
  const row = await deps.prisma.linkPreview.findUnique({ where: { cacheKey } });
  if (!row) return null;
  if (row.expiresAt.getTime() > (deps.now?.() ?? Date.now())) return row;
  await discardRow(deps, row);
  return null;
}

async function cacheFailure(deps: ServiceDeps, key: string, url: URL, code: string) {
  const now = deps.now?.() ?? Date.now();
  return deps.prisma.linkPreview.upsert({
    where: { cacheKey: key },
    create: {
      cacheKey: key,
      requestedUrl: url.href,
      status: "NEGATIVE",
      failureCode: code,
      expiresAt: new Date(now + deps.config.negativeTtlMs),
    },
    update: {
      requestedUrl: url.href,
      resolvedUrl: null,
      status: "NEGATIVE",
      failureCode: code,
      title: null,
      description: null,
      imageBlobId: null,
      faviconBlobId: null,
      expiresAt: new Date(now + deps.config.negativeTtlMs),
    },
  });
}

async function buildPreview(deps: ServiceDeps, key: string, url: URL) {
  try {
    const page = await (deps.fetchResource ?? fetchPreviewResource)(
      url,
      "html",
      networkLimits(deps.config, "page"),
    );
    const metadata = extractLinkMetadata(page.body, page.finalUrl);
    const image = await mirrorImage(deps, metadata.imageUrl, false);
    const favicon = await mirrorImage(deps, metadata.faviconUrl, true);
    if (!metadata.title && !metadata.description && !image && !favicon) {
      return cacheFailure(deps, key, url, "NO_METADATA");
    }
    const now = deps.now?.() ?? Date.now();
    return await deps.prisma.linkPreview.upsert({
      where: { cacheKey: key },
      create: {
        cacheKey: key,
        requestedUrl: url.href,
        resolvedUrl: page.finalUrl.href,
        status: "READY",
        title: metadata.title,
        description: metadata.description,
        imageBlobId: image?.id ?? null,
        faviconBlobId: favicon?.id ?? null,
        expiresAt: new Date(now + deps.config.positiveTtlMs),
      },
      update: {
        resolvedUrl: page.finalUrl.href,
        status: "READY",
        failureCode: null,
        title: metadata.title,
        description: metadata.description,
        imageBlobId: image?.id ?? null,
        faviconBlobId: favicon?.id ?? null,
        expiresAt: new Date(now + deps.config.positiveTtlMs),
      },
    });
  } catch (error) {
    const code = error instanceof PreviewFetchError ? error.code : "FETCH_FAILED";
    return cacheFailure(deps, key, url, code);
  }
}

export function createLinkPreviewService(deps: ServiceDeps) {
  const queue = new BoundedTaskQueue();
  const activeByUser = new Map<string, number>();
  const inFlight = new Map<string, Promise<LinkPreviewResult>>();

  return async (userId: string, rawUrl: string): Promise<LinkPreviewResult> => {
    const url = canonicalUrl(rawUrl);
    const key = cacheKeyFor(url);
    const cached = await freshCached(deps, key);
    if (cached) return publicResult(cached);
    const existing = inFlight.get(key);
    if (existing) return existing;

    const active = activeByUser.get(userId) ?? 0;
    if (active >= deps.config.maxConcurrentPerUser) throw new LinkPreviewBusyError();
    activeByUser.set(userId, active + 1);
    const work = queue
      .run(
        {
          concurrency: deps.config.maxConcurrentInstance,
          maxWaiting: deps.config.maxQueueSize,
        },
        async () =>
          publicResult((await freshCached(deps, key)) ?? (await buildPreview(deps, key, url))),
      )
      .finally(() => {
        const remaining = (activeByUser.get(userId) ?? 1) - 1;
        if (remaining > 0) activeByUser.set(userId, remaining);
        else activeByUser.delete(userId);
        inFlight.delete(key);
      });
    inFlight.set(key, work);
    return work;
  };
}

export async function collectExpiredLinkPreviews(deps: ServiceDeps): Promise<number> {
  const expired = await deps.prisma.linkPreview.findMany({
    where: { expiresAt: { lte: new Date(deps.now?.() ?? Date.now()) } },
  });
  for (const row of expired) await discardRow(deps, row);
  return expired.length;
}
