/**
 * Serving documents.
 *
 * Every route here answers two questions, not one: may this person see this
 * board, and does this document actually belong to that board. The second is
 * not redundant — without it anyone with access to any board could fetch any
 * document by guessing its id, and ids are the only thing standing between
 * someone and a colleague's contract.
 *
 * Both answers come from the database on every request. Nothing is read out of
 * the element that pointed here, because board contents are written by clients.
 */
import type { Express, Request, Response } from "express";
import { createReadStream } from "node:fs";
import { canEditDrawing, canViewDrawing, getDrawingAccess } from "../authz/sharing";
import { resolveStoragePath } from "./assetStorage";
import {
  AssetTooLargeError,
  QuotaExceededError,
  createAsset,
  usedBytesFor,
} from "./assetService";
import { PdfRejectedError } from "./pdfRenderer";

const ID = /^[\w-]{1,64}$/;

export type AssetRouteDeps = {
  app: Express;
  prisma: any;
  requireAuth: any;
  optionalAuth: any;
  asyncHandler: (fn: any) => any;
  storageDir: string;
  maxUploadBytes: number;
  maxPerUserBytes: number;
  /** Renders and caches a page, returning what to send. */
  getPage: (asset: any, page: number) => Promise<{
    body: Buffer;
    mimeType: string;
    contentEncoding: string | null;
  }>;
  /** Reads a document's page count after upload. */
  describeUpload: (asset: any) => Promise<{ pageCount: number | null }>;
  /**
   * Rebuilds the stored file smaller where that helps, and reports what
   * changed so the stored size stays honest.
   */
  optimizeUpload?: (asset: any) => Promise<{ finalBytes: number; note: string | null }>;
};

const principalOf = (req: Request) =>
  req.user?.id ? ({ kind: "user" as const, userId: req.user.id }) : null;

/**
 * The document, if this request is allowed to have it.
 *
 * Returns null rather than distinguishing "no such document" from "not yours",
 * so a caller cannot use the difference to find out what exists.
 */
async function authorizedAsset(deps: AssetRouteDeps, req: Request) {
  const { drawingId, assetId } = req.params;
  if (!ID.test(drawingId) || !ID.test(assetId)) return null;

  const access = await getDrawingAccess({
    prisma: deps.prisma,
    principal: principalOf(req),
    drawingId,
  });
  if (!canViewDrawing(access)) return null;

  // Belonging to the board is what makes this document reachable — either
  // because it is on the board now, or because a kept version still needs it.
  const link = await deps.prisma.drawingAsset.findUnique({
    where: { drawingId_assetId: { drawingId, assetId } },
  });
  if (!link) {
    const viaSnapshot = await deps.prisma.drawingSnapshotAsset.findFirst({
      where: { assetId, snapshot: { drawingId } },
      select: { assetId: true },
    });
    if (!viaSnapshot) return null;
  }

  const asset = await deps.prisma.asset.findUnique({
    where: { id: assetId },
    include: { blob: true },
  });
  if (!asset || asset.status !== "READY") return null;
  return { asset, access, drawingId };
}

/** A filename safe to put in a header, plus the exact one for clients that can read it. */
export function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "document";
  const encoded = encodeURIComponent(filename);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function registerAssetRoutes(deps: AssetRouteDeps): void {
  const { app, asyncHandler } = deps;

  // Upload. The body is the file itself rather than a multipart form: there is
  // one file, and streaming it straight to disk avoids buffering 30 MB in
  // memory or writing it twice.
  app.post(
    "/drawings/:drawingId/assets",
    deps.requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { drawingId } = req.params;
      if (!ID.test(drawingId)) return res.status(404).json({ error: "Drawing not found" });

      const drawing = await deps.prisma.drawing.findUnique({
        where: { id: drawingId },
        select: { userId: true },
      });
      const access = await getDrawingAccess({
        prisma: deps.prisma,
        principal: principalOf(req),
        drawingId,
      });
      if (!drawing || !canViewDrawing(access)) {
        return res.status(404).json({ error: "Drawing not found" });
      }
      if (!canEditDrawing(access)) {
        return res.status(403).json({
          error: "Read-only access",
          message: "You can view this board but not add documents to it.",
        });
      }

      const declared = String(req.headers["content-type"] ?? "").split(";")[0].trim();
      if (declared !== "application/pdf") {
        return res.status(415).json({
          error: "Unsupported file type",
          message: `Only PDF documents can be added right now, not "${declared || "unknown"}".`,
        });
      }

      const name = typeof req.query.name === "string" ? req.query.name : "document.pdf";

      try {
        // Quota is charged to whoever owns the board, not whoever dropped the
        // file, so a guest with edit access cannot spend their own allowance on
        // someone else's board or vice versa.
        const created = await createAsset(
          {
            prisma: deps.prisma,
            storageDir: deps.storageDir,
            maxUploadBytes: deps.maxUploadBytes,
            maxPerUserBytes: deps.maxPerUserBytes,
          },
          {
            ownerUserId: drawing.userId,
            uploadedByUserId: req.user?.id ?? null,
            drawingId,
            kind: "PDF",
            originalName: name,
            mimeType: "application/pdf",
            source: req,
          },
        );

        let pageCount: number | null = null;
        let note: string | null = null;
        try {
          if (deps.optimizeUpload) {
            const optimized = await deps.optimizeUpload({ ...created.asset, blob: created.blob });
            note = optimized.note;
            if (optimized.finalBytes !== created.blob.storedBytes) {
              // The bytes on disk changed, so what the quota counts has to
              // change with them.
              await deps.prisma.storedBlob.update({
                where: { id: created.blob.id },
                data: { sizeBytes: optimized.finalBytes, storedBytes: optimized.finalBytes },
              });
            }
          }

          // The created row does not carry its blob, and describeUpload needs
          // to find the bytes on disk.
          ({ pageCount } = await deps.describeUpload({ ...created.asset, blob: created.blob }));
          if (pageCount !== null) {
            await deps.prisma.asset.update({
              where: { id: created.asset.id },
              data: { pageCount },
            });
          }
        } catch (err) {
          // The bytes are stored but unusable. Say so and take them back out
          // rather than leaving a document that can never be opened.
          await deps.prisma.drawingAsset.deleteMany({ where: { assetId: created.asset.id } });
          await deps.prisma.asset.update({
            where: { id: created.asset.id },
            data: { status: "REJECTED", deleteAfter: new Date() },
          });
          if (err instanceof PdfRejectedError) {
            return res.status(422).json({ error: "Unreadable document", message: err.message });
          }
          throw err;
        }

        return res.status(201).json({
          id: created.asset.id,
          kind: "PDF",
          name: created.asset.originalName,
          sizeBytes: created.sizeBytes,
          pageCount,
          note,
        });
      } catch (err) {
        if (err instanceof AssetTooLargeError) {
          return res.status(413).json({ error: "File too large", message: err.message });
        }
        if (err instanceof QuotaExceededError) {
          return res.status(507).json({ error: "Storage limit reached", message: err.message });
        }
        throw err;
      }
    }),
  );

  // What the widget needs to draw itself. Deliberately not the storage key.
  app.get(
    "/drawings/:drawingId/assets/:assetId",
    deps.optionalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const found = await authorizedAsset(deps, req);
      if (!found) return res.status(404).json({ error: "Document not found" });

      res.setHeader("Cache-Control", "private, no-cache, must-revalidate");
      return res.json({
        id: found.asset.id,
        kind: found.asset.kind,
        name: found.asset.originalName,
        pageCount: found.asset.pageCount,
        sizeBytes: found.asset.blob?.sizeBytes ?? null,
      });
    }),
  );

  // The original, always as a download. Never rendered in place: whatever a
  // browser decides to do with a foreign file, it should not do it on our origin.
  app.get(
    "/drawings/:drawingId/assets/:assetId/original",
    deps.optionalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const found = await authorizedAsset(deps, req);
      if (!found?.asset.blob) return res.status(404).json({ error: "Document not found" });

      const { blob } = found.asset;
      res.setHeader("Content-Type", found.asset.mimeType);
      res.setHeader("Content-Disposition", contentDisposition("attachment", found.asset.originalName));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Cache-Control", "private, no-cache, must-revalidate");
      res.setHeader("Vary", "Cookie, Authorization");
      res.setHeader("ETag", `"${blob.sha256}"`);
      if (blob.contentEncoding) res.setHeader("Content-Encoding", blob.contentEncoding);

      if (req.headers["if-none-match"] === `"${blob.sha256}"`) return res.status(304).end();

      return createReadStream(resolveStoragePath(deps.storageDir, blob.storageKey)).pipe(res);
    }),
  );

  // One rendered page.
  app.get(
    "/drawings/:drawingId/assets/:assetId/pages/:page",
    deps.optionalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const found = await authorizedAsset(deps, req);
      if (!found) return res.status(404).json({ error: "Document not found" });

      const page = Number(req.params.page);
      const total = found.asset.pageCount ?? 0;
      if (!Number.isInteger(page) || page < 1 || page > total) {
        return res.status(404).json({
          error: "No such page",
          message: `This document has ${total} page${total === 1 ? "" : "s"}.`,
        });
      }

      try {
        const rendered = await deps.getPage(found.asset, page);
        res.setHeader("Content-Type", rendered.mimeType);
        res.setHeader("Content-Disposition", contentDisposition("inline", `page-${page}`));
        res.setHeader("X-Content-Type-Options", "nosniff");
        // A page is drawn inside an <img>, where nothing can run. This says so
        // to the browser as well rather than relying on that alone.
        res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        res.setHeader("Cache-Control", "private, no-cache, must-revalidate");
        res.setHeader("Vary", "Cookie, Authorization");
        if (rendered.contentEncoding) res.setHeader("Content-Encoding", rendered.contentEncoding);
        return res.send(rendered.body);
      } catch (err) {
        if (err instanceof PdfRejectedError) {
          return res.status(422).json({ error: "Page unavailable", message: err.message });
        }
        throw err;
      }
    }),
  );

  // How much room is left, so the interface can say so before someone waits
  // for a 30 MB upload only to be told no.
  app.get(
    "/assets/usage",
    deps.requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const used = await usedBytesFor(deps.prisma, req.user!.id);
      return res.json({ usedBytes: used, limitBytes: deps.maxPerUserBytes });
    }),
  );
}
