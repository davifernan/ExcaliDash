import { describe, expect, it, vi } from "vitest";
import type { LinkPreviewConfig } from "../config";
import { createLinkPreviewService, LinkPreviewBusyError } from "./service";
import { PreviewFetchError } from "./network";

const config: LinkPreviewConfig = {
  positiveTtlMs: 60_000,
  negativeTtlMs: 10_000,
  dnsTimeoutMs: 100,
  connectTimeoutMs: 100,
  totalTimeoutMs: 1_000,
  maxRedirects: 2,
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
};

function fakePrisma() {
  const rows = new Map<string, any>();
  let ids = 0;
  return {
    rows,
    linkPreview: {
      findUnique: async ({ where }: any) =>
        where.cacheKey ? (rows.get(where.cacheKey) ?? null) : null,
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
              ...create,
            };
        rows.set(where.cacheKey, row);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        for (const [key, value] of rows) if (value.id === where.id) rows.delete(key);
      },
      count: async () => 0,
      findMany: async () => [],
    },
    asset: { count: async () => 0 },
    storedBlob: { findUnique: async () => null },
  };
}

describe("link preview caching and admission", () => {
  it("serves repeated successful requests from the persistent cache", async () => {
    const prisma = fakePrisma();
    const fetchResource = vi.fn().mockResolvedValue({
      body: Buffer.from(
        '<html><head><title>Cached title</title><link rel="icon" href="data:,x"></head>',
      ),
      finalUrl: new URL("https://example.com/final"),
      contentType: "text/html",
      headers: {},
    });
    const getPreview = createLinkPreviewService({
      prisma,
      storageDir: "/unused",
      config,
      fetchResource,
    });

    expect((await getPreview("user-1", "https://example.com/start")).title).toBe("Cached title");
    expect((await getPreview("user-1", "https://example.com/start#fragment")).title).toBe(
      "Cached title",
    );
    expect(fetchResource).toHaveBeenCalledTimes(1);
  });

  it("caches failures so a bad target is not fetched repeatedly", async () => {
    const prisma = fakePrisma();
    const fetchResource = vi
      .fn()
      .mockRejectedValue(new PreviewFetchError("TOO_LARGE", "too large"));
    const getPreview = createLinkPreviewService({
      prisma,
      storageDir: "/unused",
      config,
      fetchResource,
    });

    expect((await getPreview("user-1", "https://example.com/huge")).failureCode).toBe("TOO_LARGE");
    expect((await getPreview("user-1", "https://example.com/huge")).failureCode).toBe("TOO_LARGE");
    expect(fetchResource).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent requests for the same address", async () => {
    const prisma = fakePrisma();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchResource = vi.fn().mockImplementation(async () => {
      await held;
      return {
        body: Buffer.from('<head><title>One fetch</title><link rel="icon" href="data:,x"></head>'),
        finalUrl: new URL("https://example.com"),
        contentType: "text/html",
        headers: {},
      };
    });
    const getPreview = createLinkPreviewService({
      prisma,
      storageDir: "/unused",
      config,
      fetchResource,
    });
    const first = getPreview("user-1", "https://example.com");
    const second = getPreview("user-2", "https://example.com");
    await vi.waitFor(() => expect(fetchResource).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);
    expect(fetchResource).toHaveBeenCalledTimes(1);
  });

  it("limits simultaneous preview work per user", async () => {
    const prisma = fakePrisma();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchResource = vi.fn().mockImplementation(async () => {
      await held;
      return {
        body: Buffer.from('<head><title>Done</title><link rel="icon" href="data:,x"></head>'),
        finalUrl: new URL("https://example.com"),
        contentType: "text/html",
        headers: {},
      };
    });
    const getPreview = createLinkPreviewService({
      prisma,
      storageDir: "/unused",
      config,
      fetchResource,
    });
    const first = getPreview("user-1", "https://one.example");
    await vi.waitFor(() => expect(fetchResource).toHaveBeenCalledTimes(1));
    await expect(getPreview("user-1", "https://two.example")).rejects.toBeInstanceOf(
      LinkPreviewBusyError,
    );
    release();
    await first;
  });
});
