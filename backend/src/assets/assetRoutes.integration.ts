/**
 * The document routes, against real Express handlers and a real database.
 *
 * The point of these is the authorization, and authorization is exactly the
 * thing a mocked test proves nothing about.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { PrismaClient } from "../generated/client";
import { getTestPrisma, setupTestDb, cleanupTestDb, createTestUser } from "../__tests__/testUtils";
import { createAsset } from "./assetService";
import { contentDisposition, registerAssetRoutes } from "./assetRoutes";

describe("document routes", () => {
  let prisma: PrismaClient;
  let storageDir: string;
  let app: express.Express;
  let owner: any;
  let stranger: any;
  let viewer: any;
  let drawingId: string;
  let assetId: string;
  let actAs: string | null;

  const asyncHandler = (fn: any) => (req: any, res: any, next: any) =>
    Promise.resolve(fn(req, res, next)).catch(next);

  beforeAll(async () => {
    setupTestDb();
    prisma = getTestPrisma();
  });

  afterAll(async () => {
    await cleanupTestDb(prisma);
    await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await prisma.drawingSnapshotAsset.deleteMany({});
    await prisma.drawingAsset.deleteMany({});
    await prisma.asset.deleteMany({});
    await prisma.storedBlob.deleteMany({});
    await prisma.drawingPermission.deleteMany({});
    await prisma.drawingSnapshot.deleteMany({});
    await prisma.drawing.deleteMany({});
    await prisma.user.deleteMany({});

    storageDir = await mkdtemp(join(tmpdir(), "assetroutes-"));
    owner = await createTestUser(prisma, "owner@example.com");
    stranger = await createTestUser(prisma, "stranger@example.com");
    viewer = await createTestUser(prisma, "viewer@example.com");
    actAs = owner.id;

    const drawing = await prisma.drawing.create({
      data: { name: "Board", elements: "[]", appState: "{}", userId: owner.id },
    });
    drawingId = drawing.id;

    const created = await createAsset(
      { prisma, storageDir, maxUploadBytes: 1_000_000, maxPerUserBytes: 10_000_000 },
      {
        ownerUserId: owner.id,
        uploadedByUserId: owner.id,
        drawingId,
        kind: "PDF",
        originalName: "Quartalsbericht Q3.pdf",
        mimeType: "application/pdf",
        source: Readable.from([Buffer.from("%PDF-1.4 pretend")]),
      },
    );
    assetId = created.asset.id;
    await prisma.asset.update({ where: { id: assetId }, data: { pageCount: 3 } });

    app = express();
    // Stands in for the real auth middleware: the tests care about what the
    // routes do with an identity, not how it was established.
    const attach = (req: any, _res: any, next: any) => {
      if (actAs) req.user = { id: actAs };
      next();
    };
    registerAssetRoutes({
      app,
      prisma,
      requireAuth: (req: any, res: any, next: any) => {
        attach(req, res, () => {});
        if (!req.user) return res.status(401).json({ error: "Unauthorized" });
        next();
      },
      optionalAuth: attach,
      asyncHandler,
      storageDir,
      maxUploadBytes: 1_000_000,
      maxPerUserBytes: 10_000_000,
      getPage: async (_asset: any, page: number) => ({
        body: Buffer.from(`<svg>page ${page}</svg>`),
        mimeType: "image/svg+xml",
        contentEncoding: null,
      }),
      describeUpload: async (asset: any) => {
        // Guards the wiring, not just the shape: this needs the bytes to look
        // at, and the created row does not carry them by itself.
        if (!asset?.blob?.storageKey) {
          throw new Error("describeUpload was given no blob to read");
        }
        return { pageCount: 7 };
      },
    });
  });

  const url = (suffix = "") => `/drawings/${drawingId}/assets/${assetId}${suffix}`;

  describe("who may read a document", () => {
    it("lets the owner read it", async () => {
      const res = await request(app).get(url()).expect(200);
      expect(res.body.name).toBe("Quartalsbericht Q3.pdf");
      expect(res.body.pageCount).toBe(3);
    });

    it("hides it from someone with no access to the board", async () => {
      actAs = stranger.id;
      await request(app).get(url()).expect(404);
    });

    it("hides it from a signed-out visitor", async () => {
      actAs = null;
      await request(app).get(url()).expect(404);
    });

    it("lets someone the board was shared with read it", async () => {
      await prisma.drawingPermission.create({
        data: {
          drawingId,
          granteeUserId: viewer.id,
          permission: "view",
          createdByUserId: owner.id,
        },
      });
      actAs = viewer.id;
      await request(app).get(url()).expect(200);
    });
  });

  describe("belonging to the board, not just access to some board", () => {
    it("refuses a document that belongs to a different board", async () => {
      const otherBoard = await prisma.drawing.create({
        data: { name: "Other", elements: "[]", appState: "{}", userId: owner.id },
      });
      // The owner may see both boards, but this document is not on this one.
      await request(app).get(`/drawings/${otherBoard.id}/assets/${assetId}`).expect(404);
    });

    it("still serves a document only a kept version still needs", async () => {
      const snapshot = await prisma.drawingSnapshot.create({
        data: { drawingId, version: 1, elements: "[]", appState: "{}" },
      });
      await prisma.drawingSnapshotAsset.create({ data: { snapshotId: snapshot.id, assetId } });
      await prisma.drawingAsset.deleteMany({ where: { assetId } });

      await request(app).get(url()).expect(200);
    });

    it("refuses an id that does not exist without saying so differently", async () => {
      const res = await request(app).get(`/drawings/${drawingId}/assets/does-not-exist`);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Document not found");
    });
  });

  describe("the original", () => {
    it("is sent as a download, never rendered in place", async () => {
      const res = await request(app).get(url("/original")).expect(200);
      expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["content-security-policy"]).toContain("sandbox");
    });

    it("carries the real filename for clients that can read it", async () => {
      const res = await request(app).get(url("/original")).expect(200);
      expect(res.headers["content-disposition"]).toContain("filename*=UTF-8''");
    });

    it("is not cached by shared caches", async () => {
      const res = await request(app).get(url("/original")).expect(200);
      expect(res.headers["cache-control"]).toContain("private");
      expect(res.headers["vary"]).toContain("Cookie");
    });

    it("answers 304 when the client already has it", async () => {
      const first = await request(app).get(url("/original")).expect(200);
      await request(app).get(url("/original")).set("If-None-Match", first.headers.etag).expect(304);
    });
  });

  describe("pages", () => {
    it("renders a page that exists", async () => {
      const res = await request(app).get(url("/pages/2")).buffer(true).expect(200);
      expect(res.headers["content-type"]).toContain("image/svg+xml");
      expect(Buffer.from(res.body).toString()).toContain("page 2");
    });

    it("refuses a page past the end and says how many there are", async () => {
      const res = await request(app).get(url("/pages/9")).expect(404);
      expect(res.body.message).toContain("3 pages");
    });

    it("refuses a page that is not a positive whole number", async () => {
      await request(app).get(url("/pages/0")).expect(404);
      await request(app).get(url("/pages/-1")).expect(404);
      await request(app).get(url("/pages/abc")).expect(404);
    });

    it("marks pages so nothing can run inside them", async () => {
      const res = await request(app).get(url("/pages/1")).expect(200);
      expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });
  });

  describe("uploading", () => {
    const upload = (body: Buffer | string, type = "application/pdf") =>
      request(app)
        .post(`/drawings/${drawingId}/assets?name=neu.pdf`)
        .set("Content-Type", type)
        .send(body as any);

    it("accepts a PDF and reports its page count", async () => {
      const res = await upload(Buffer.from("%PDF-1.4 more")).expect(201);
      expect(res.body.pageCount).toBe(7);
      expect(res.body.name).toBe("neu.pdf");
    });

    it("refuses anything that is not a PDF", async () => {
      const res = await upload("<html>hi</html>", "text/html").expect(415);
      expect(res.body.message).toContain("text/html");
    });

    it("refuses someone with only view access", async () => {
      await prisma.drawingPermission.create({
        data: {
          drawingId,
          granteeUserId: viewer.id,
          permission: "view",
          createdByUserId: owner.id,
        },
      });
      actAs = viewer.id;
      const res = await upload(Buffer.from("%PDF-1.4 x")).expect(403);
      expect(res.body.message).toContain("not add documents");
    });

    it("refuses a stranger without revealing that the board exists", async () => {
      actAs = stranger.id;
      await upload(Buffer.from("%PDF-1.4 x")).expect(404);
    });

    it("charges the board owner rather than whoever uploaded", async () => {
      await prisma.drawingPermission.create({
        data: {
          drawingId,
          granteeUserId: viewer.id,
          permission: "edit",
          createdByUserId: owner.id,
        },
      });
      actAs = viewer.id;
      const res = await upload(Buffer.from("%PDF-1.4 uploaded by guest")).expect(201);

      const asset = await prisma.asset.findUnique({ where: { id: res.body.id } });
      expect(asset?.ownerUserId).toBe(owner.id);
      expect(asset?.uploadedByUserId).toBe(viewer.id);
    });
  });
});

describe("filenames in headers", () => {
  it("keeps a plain name as it is", () => {
    expect(contentDisposition("attachment", "report.pdf")).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
  });

  it("replaces characters a header cannot carry", () => {
    const value = contentDisposition("attachment", "Bericht Q3 – Übersicht.pdf");
    expect(value).toContain('filename="Bericht Q3 _ _bersicht.pdf"');
    expect(value).toContain("filename*=UTF-8''Bericht%20Q3%20%E2%80%93%20%C3%9Cbersicht.pdf");
  });

  it("cannot break out of the quoted filename", () => {
    // The quote is the only character that could end the quoted string early;
    // semicolons and spaces inside it are harmless.
    const value = contentDisposition("attachment", 'evil"; download; x="');
    const quoted = value.match(/filename="([^"]*)"/);
    expect(quoted).not.toBeNull();
    expect(quoted![1]).not.toContain('"');
    expect(value).toContain("filename*=UTF-8''evil%22");
  });

  it("falls back to a name when there is nothing usable left", () => {
    expect(contentDisposition("inline", "———")).toContain('filename="___"');
  });
});
