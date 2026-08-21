import { vi } from "vitest";
import type { LinkPreviewConfig } from "../config";

export const previewTestConfig: LinkPreviewConfig = {
  positiveTtlMs: 60_000,
  negativeTtlMs: 10_000,
  dnsTimeoutMs: 100,
  connectTimeoutMs: 100,
  totalTimeoutMs: 1_000,
  maxRedirects: 2,
  allowedPorts: [80, 443],
  dnsConcurrency: 2,
  dnsQueueSize: 4,
  maxPageWireBytes: 10_000,
  maxPageDecodedBytes: 10_000,
  maxImageWireBytes: 10_000,
  maxImageDecodedBytes: 10_000,
  maxSanitizedImageBytes: 10_000,
  maxImagePixels: 1_000_000,
  maxImageDimension: 1_000,
  maxFaviconDimension: 128,
  imageProcessTimeoutMs: 1_000,
  maxConcurrentPerUser: 1,
  maxConcurrentInstance: 2,
  maxQueueSize: 2,
  cacheBudgetBytes: 100_000,
  maxBytesPerUser: 50_000,
  maxEntriesPerUser: 10,
  minFreeDiskPercent: 0,
  cleanupBatchSize: 2,
};

export function fakePreviewPrisma() {
  const rows = new Map<string, any>();
  const blobs = new Map<string, any>();
  let ids = 0;
  const previewMatches = (row: any, where: any = {}) => {
    if (where.ownerUserId !== undefined && row.ownerUserId !== where.ownerUserId) return false;
    if (where.expiresAt?.lte && row.expiresAt > where.expiresAt.lte) return false;
    if (where.OR) {
      return where.OR.some(
        (part: any) =>
          (part.imageBlobId && row.imageBlobId === part.imageBlobId) ||
          (part.faviconBlobId && row.faviconBlobId === part.faviconBlobId),
      );
    }
    return true;
  };
  return {
    rows,
    blobs,
    linkPreview: {
      findUnique: async ({ where }: any) =>
        where.cacheKey
          ? (rows.get(where.cacheKey) ?? null)
          : ([...rows.values()].find((row) => row.id === where.id) ?? null),
      update: async ({ where, data }: any) => {
        const entry = [...rows.entries()].find(([, row]) => row.id === where.id);
        if (!entry) throw new Error("missing preview");
        const updated = { ...entry[1], ...data };
        rows.set(entry[0], updated);
        return updated;
      },
      upsert: async ({ where, create, update }: any) => {
        const old = rows.get(where.cacheKey);
        const row = old
          ? { ...old, ...update, updatedAt: new Date() }
          : {
              id: `00000000-0000-0000-0000-${String(++ids).padStart(12, "0")}`,
              failureCode: null,
              resolvedUrl: null,
              title: null,
              description: null,
              imageBlobId: null,
              faviconBlobId: null,
              ownerUserId: null,
              lastAccessedAt: new Date(),
              ...create,
            };
        rows.set(where.cacheKey, row);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        for (const [key, value] of rows) if (value.id === where.id) rows.delete(key);
      },
      count: async ({ where = {} }: any = {}) =>
        [...rows.values()].filter((row) => previewMatches(row, where)).length,
      findMany: vi.fn(async ({ where = {}, orderBy, take }: any = {}) => {
        const selected = [...rows.values()].filter((row) => previewMatches(row, where));
        if (orderBy) {
          const fields = orderBy.map((part: any) => Object.keys(part)[0]);
          selected.sort((a, b) => {
            for (const field of fields) {
              const left = a[field] instanceof Date ? a[field].getTime() : a[field];
              const right = b[field] instanceof Date ? b[field].getTime() : b[field];
              if (left < right) return -1;
              if (left > right) return 1;
            }
            return 0;
          });
        }
        return selected.slice(0, take ?? selected.length);
      }),
    },
    asset: { count: async () => 0 },
    storedBlob: {
      aggregate: async ({ where }: any) => {
        const referenced = new Set<string>();
        const ownerUserId = where.OR.map(
          (part: any) =>
            part.linkPreviewImages?.some?.ownerUserId ??
            part.linkPreviewFavicons?.some?.ownerUserId,
        ).find(Boolean);
        const countsDisk = where.OR.some((part: any) => part.purpose === "LINK_PREVIEW");
        for (const row of rows.values()) {
          if (ownerUserId && row.ownerUserId !== ownerUserId) continue;
          if (row.imageBlobId) referenced.add(row.imageBlobId);
          if (row.faviconBlobId) referenced.add(row.faviconBlobId);
        }
        return {
          _sum: {
            storedBytes: [...blobs.values()]
              .filter((blob) =>
                ownerUserId
                  ? referenced.has(blob.id)
                  : (countsDisk && blob.purpose === "LINK_PREVIEW") || referenced.has(blob.id),
              )
              .reduce((sum, blob) => sum + blob.storedBytes, 0),
          },
        };
      },
      findUnique: async ({ where }: any) =>
        where.id
          ? (blobs.get(where.id) ?? null)
          : ([...blobs.values()].find((blob) => blob.sha256 === where.sha256) ?? null),
      create: async ({ data }: any) => {
        const blob = {
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          deleteAfter: null,
        };
        blobs.set(blob.id, blob);
        return blob;
      },
      update: async ({ where, data }: any) => {
        const blob = blobs.get(where.id);
        if (!blob) throw new Error("missing blob");
        const updated = { ...blob, ...data, updatedAt: new Date() };
        blobs.set(where.id, updated);
        return updated;
      },
      updateMany: vi.fn(async ({ where, data }: any) => {
        const blob = blobs.get(where.id);
        if (!blob) return { count: 0 };
        blobs.set(where.id, { ...blob, ...data });
        return { count: 1 };
      }),
      deleteMany: async ({ where }: any) => ({ count: blobs.delete(where.id) ? 1 : 0 }),
      findMany: vi.fn(async ({ where, take }: any) =>
        [...blobs.values()]
          .filter((blob) => {
            const referenced = [...rows.values()].some(
              (row) => row.imageBlobId === blob.id || row.faviconBlobId === blob.id,
            );
            if (referenced) return false;
            const due = blob.deleteAfter && blob.deleteAfter <= where.OR[0].deleteAfter.lte;
            const abandoned = !blob.deleteAfter && blob.createdAt <= where.OR[1].createdAt.lte;
            return blob.purpose === "LINK_PREVIEW" && blob.state === "READY" && (due || abandoned);
          })
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(0, take),
      ),
    },
  };
}
