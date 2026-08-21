import { createReadStream } from "node:fs";
import type { Express, Request, Response } from "express";
import { QueueCapacityError } from "../utils/boundedTaskQueue";
import { resolveStoragePath } from "../assets/assetStorage";
import { LinkPreviewBusyError, type LinkPreviewResult } from "./service";
import { PreviewFetchError } from "./network";

type RouteDeps = {
  app: Express;
  prisma: any;
  requireAuth: any;
  asyncHandler: any;
  storageDir: string;
  getPreview: (userId: string, url: string) => Promise<LinkPreviewResult>;
  now?: () => number;
};

const ID = /^[a-f0-9-]{36}$/i;

function responseFor(row: LinkPreviewResult) {
  return {
    id: row.id,
    url: row.requestedUrl,
    resolvedUrl: row.resolvedUrl,
    title: row.title,
    description: row.description,
    imageUrl: row.imageBlobId ? `/api/link-previews/${row.id}/image` : null,
    faviconUrl: row.faviconBlobId ? `/api/link-previews/${row.id}/favicon` : null,
  };
}

export function registerLinkPreviewRoutes(deps: RouteDeps): void {
  deps.app.post(
    "/link-previews",
    deps.requireAuth,
    deps.asyncHandler(async (req: Request, res: Response) => {
      const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
      if (!url || url.length > 4_096) {
        return res.status(400).json({ error: "Invalid URL", message: "A URL is required." });
      }
      try {
        const preview = await deps.getPreview(req.user!.id, url);
        res.setHeader("Cache-Control", "private, no-store");
        if (preview.status === "NEGATIVE") {
          return res.status(422).json({
            error: "Preview unavailable",
            code: preview.failureCode,
            message: "No safe preview could be produced for this URL.",
          });
        }
        return res.json(responseFor(preview));
      } catch (error) {
        if (error instanceof LinkPreviewBusyError || error instanceof QueueCapacityError) {
          res.setHeader("Retry-After", "2");
          return res.status(429).json({
            error: "Preview limit reached",
            message: "Too many link previews are being fetched. Try again shortly.",
          });
        }
        if (error instanceof PreviewFetchError && error.code === "INVALID_URL") {
          return res.status(400).json({ error: "Invalid URL", message: error.message });
        }
        throw error;
      }
    }),
  );

  deps.app.get(
    "/link-previews/:id/:kind",
    deps.requireAuth,
    deps.asyncHandler(async (req: Request, res: Response) => {
      if (!ID.test(req.params.id) || !["image", "favicon"].includes(req.params.kind)) {
        return res.status(404).json({ error: "Preview not found" });
      }
      const preview = await deps.prisma.linkPreview.findUnique({
        where: { id: req.params.id },
        include: { imageBlob: true, faviconBlob: true },
      });
      if (!preview || preview.expiresAt.getTime() <= (deps.now?.() ?? Date.now())) {
        return res.status(404).json({ error: "Preview not found" });
      }
      const blob = req.params.kind === "image" ? preview.imageBlob : preview.faviconBlob;
      if (!blob) return res.status(404).json({ error: "Preview image not found" });

      res.setHeader("Content-Type", "image/webp");
      res.setHeader("Content-Length", String(blob.sizeBytes));
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("Vary", "Cookie, Authorization");
      res.setHeader("ETag", `"${blob.sha256}"`);
      if (req.headers["if-none-match"] === `"${blob.sha256}"`) return res.status(304).end();
      return createReadStream(resolveStoragePath(deps.storageDir, blob.storageKey)).pipe(res);
    }),
  );
}
