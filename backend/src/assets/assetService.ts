/**
 * Uploaded documents: the bookkeeping around the bytes.
 *
 * Two ideas carry this module.
 *
 * Bytes and documents are separate. The same PDF dropped onto three boards by
 * three people is one file on disk and three assets in the database, each with
 * its own name, owner and quota. Sharing one row across owners instead would
 * make one person's delete able to take away someone else's document.
 *
 * A board only ever names an asset by id. Filename, page count, MIME type and
 * permission are read from here on every request, never taken from the element
 * that referred to them — a board's contents are written by clients, and a
 * client is not a source of truth about what it is allowed to see.
 */
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import {
  AssetTooLargeError,
  originalKey,
  removeStored,
  shouldCompress,
  storeStream,
} from "./assetStorage";

export type AssetKind = "PDF" | "MARKDOWN" | "TEXT";

/** Grace period for an upload that no save ever referred to. */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
/** Grace period before bytes nobody references are removed from disk. */
export const BLOB_GRACE_MS = 24 * 60 * 60 * 1000;

export class QuotaExceededError extends Error {
  constructor(usedBytes: number, limitBytes: number) {
    super(
      `Storage limit reached: ${Math.round(usedBytes / 1024 / 1024)} MB of ` +
      `${Math.round(limitBytes / 1024 / 1024)} MB in use. Delete a document to free space.`,
    );
    this.name = "QuotaExceededError";
  }
}

type Deps = {
  prisma: any;
  storageDir: string;
  maxUploadBytes: number;
  maxPerUserBytes: number;
  now?: () => number;
};

/**
 * How many bytes of disk this owner's documents occupy.
 *
 * Counted per blob and by what is actually written, so an owner who put the
 * same file on two boards pays for it once, and a file stored compressed costs
 * what it costs rather than what it would have cost.
 */
export async function usedBytesFor(prisma: any, ownerUserId: string): Promise<number> {
  const assets = await prisma.asset.findMany({
    where: { ownerUserId },
    select: { blobId: true, blob: { select: { storedBytes: true } } },
  });
  const byBlob = new Map<string, number>();
  for (const asset of assets) byBlob.set(asset.blobId, asset.blob?.storedBytes ?? 0);
  return [...byBlob.values()].reduce((sum, bytes) => sum + bytes, 0);
}

export type CreateAssetInput = {
  ownerUserId: string;
  uploadedByUserId: string | null;
  drawingId: string;
  kind: AssetKind;
  originalName: string;
  mimeType: string;
  source: Readable;
};

/**
 * Take an upload, store it, and attach it to a board as pending.
 *
 * Pending rather than active because the board that refers to it has not been
 * saved yet. If that save never happens — the tab is closed, the upload is
 * cancelled — the sweep below removes it rather than keeping a file nobody can
 * reach.
 */
export async function createAsset(deps: Deps, input: CreateAssetInput) {
  const now = deps.now?.() ?? Date.now();

  const used = await usedBytesFor(deps.prisma, input.ownerUserId);
  if (used >= deps.maxPerUserBytes) {
    throw new QuotaExceededError(used, deps.maxPerUserBytes);
  }

  // The file is written before its hash is known, so it lands under a
  // provisional id. If those exact bytes turn out to be on disk already, the
  // provisional copy is thrown away and the existing one reused.
  const provisionalId = randomUUID();
  const stored = await storeStream(
    deps.storageDir,
    originalKey(provisionalId),
    input.source,
    Math.min(deps.maxUploadBytes, deps.maxPerUserBytes - used),
    { compress: shouldCompress(input.mimeType) },
  );

  let blob = await deps.prisma.storedBlob.findUnique({ where: { sha256: stored.sha256 } });
  if (blob) {
    await removeStored(deps.storageDir, stored.storageKey);
    if (blob.deleteAfter) {
      // It was on its way out; a new reference cancels that.
      blob = await deps.prisma.storedBlob.update({
        where: { id: blob.id },
        data: { deleteAfter: null, state: "READY" },
      });
    }
  } else {
    try {
      blob = await deps.prisma.storedBlob.create({
        data: {
          id: provisionalId,
          sha256: stored.sha256,
          sizeBytes: stored.sizeBytes,
          storedBytes: stored.storedBytes,
          contentEncoding: stored.contentEncoding,
          storageKey: stored.storageKey,
          state: "READY",
        },
      });
    } catch (err: any) {
      // Two uploads of the same bytes at the same time: sha256 is unique, so
      // one of them loses the race and joins the winner instead.
      if (err?.code !== "P2002") throw err;
      await removeStored(deps.storageDir, stored.storageKey);
      blob = await deps.prisma.storedBlob.findUnique({ where: { sha256: stored.sha256 } });
      if (!blob) throw err;
    }
  }

  const asset = await deps.prisma.asset.create({
    data: {
      ownerUserId: input.ownerUserId,
      uploadedByUserId: input.uploadedByUserId,
      blobId: blob.id,
      kind: input.kind,
      originalName: input.originalName.slice(0, 255),
      mimeType: input.mimeType,
      status: "READY",
    },
  });

  await deps.prisma.drawingAsset.create({
    data: {
      drawingId: input.drawingId,
      assetId: asset.id,
      state: "PENDING",
      expiresAt: new Date(now + PENDING_TTL_MS),
    },
  });

  return { asset, blob, sizeBytes: stored.sizeBytes, storedBytes: stored.storedBytes };
}

/**
 * Reconcile a board's documents with what its elements actually refer to.
 *
 * Called from the save, inside the same transaction, so a board and its
 * document list can never disagree. Ids the board does not own are refused
 * rather than ignored: a client naming someone else's asset is not a mistake to
 * paper over.
 */
export async function syncDrawingAssets(
  prisma: any,
  drawingId: string,
  referencedAssetIds: string[],
): Promise<{ activated: string[]; detached: string[] }> {
  const wanted = [...new Set(referencedAssetIds)];
  const existing = await prisma.drawingAsset.findMany({ where: { drawingId } });
  const known = new Set(existing.map((row: any) => row.assetId));

  const unknown = wanted.filter((id) => !known.has(id));
  if (unknown.length) {
    throw new Error(
      `This board does not have ${unknown.length === 1 ? "a document" : "documents"} ` +
      `with id ${unknown.map((id) => `"${id}"`).join(", ")}. Upload the file to this board first.`,
    );
  }

  const activated: string[] = [];
  for (const row of existing) {
    if (wanted.includes(row.assetId) && row.state !== "ACTIVE") {
      await prisma.drawingAsset.update({
        where: { drawingId_assetId: { drawingId, assetId: row.assetId } },
        data: { state: "ACTIVE", expiresAt: null },
      });
      activated.push(row.assetId);
    }
  }

  // Removing the widget from the board detaches the document. The bytes stay
  // until nothing — not even a snapshot — refers to them.
  const detached = existing
    .filter((row: any) => row.state === "ACTIVE" && !wanted.includes(row.assetId))
    .map((row: any) => row.assetId);
  for (const assetId of detached) {
    await prisma.drawingAsset.delete({
      where: { drawingId_assetId: { drawingId, assetId } },
    });
  }

  return { activated, detached };
}

/**
 * Record which documents a snapshot needs.
 *
 * Without this, restoring an old version would bring back elements pointing at
 * documents that were swept away in the meantime.
 */
export async function captureSnapshotAssets(
  prisma: any,
  snapshotId: string,
  drawingId: string,
): Promise<string[]> {
  const active = await prisma.drawingAsset.findMany({
    where: { drawingId, state: "ACTIVE" },
    select: { assetId: true },
  });
  for (const row of active) {
    await prisma.drawingSnapshotAsset.create({
      data: { snapshotId, assetId: row.assetId },
    });
  }
  return active.map((row: any) => row.assetId);
}

/**
 * Remove uploads no save ever claimed, then mark bytes nothing refers to.
 *
 * Deliberately two steps with a grace period between them: a board deleted by
 * mistake and restored from a snapshot should still find its documents.
 */
export async function sweepUnclaimed(deps: Deps): Promise<{ pending: number; marked: number }> {
  const now = deps.now?.() ?? Date.now();

  const stale = await deps.prisma.drawingAsset.findMany({
    where: { state: "PENDING", expiresAt: { lt: new Date(now) } },
    select: { drawingId: true, assetId: true },
  });
  for (const row of stale) {
    await deps.prisma.drawingAsset.delete({
      where: { drawingId_assetId: { drawingId: row.drawingId, assetId: row.assetId } },
    });
  }

  const orphans = await deps.prisma.asset.findMany({
    where: { drawings: { none: {} }, snapshots: { none: {} }, deleteAfter: null },
    select: { id: true },
  });
  for (const row of orphans) {
    await deps.prisma.asset.update({
      where: { id: row.id },
      data: { deleteAfter: new Date(now + BLOB_GRACE_MS) },
    });
  }

  return { pending: stale.length, marked: orphans.length };
}

/** Delete assets whose grace period has run out, and the bytes they were the last to hold. */
export async function collectExpired(deps: Deps): Promise<{ assets: number; blobs: number }> {
  const now = deps.now?.() ?? Date.now();

  const expired = await deps.prisma.asset.findMany({
    where: { deleteAfter: { lt: new Date(now) }, drawings: { none: {} }, snapshots: { none: {} } },
    select: { id: true, blobId: true },
  });
  for (const asset of expired) {
    await deps.prisma.asset.delete({ where: { id: asset.id } });
  }

  const touchedBlobs = [...new Set(expired.map((a: any) => a.blobId))] as string[];
  let removed = 0;
  for (const blobId of touchedBlobs) {
    const stillUsed = await deps.prisma.asset.count({ where: { blobId } });
    if (stillUsed > 0) continue;
    const blob = await deps.prisma.storedBlob.findUnique({ where: { id: blobId } });
    if (!blob) continue;
    // Disk first, row second: a missing file with a row left over is a broken
    // document, a row-less file is a byte on disk the sweep can find again.
    await removeStored(deps.storageDir, blob.storageKey);
    await deps.prisma.storedBlob.delete({ where: { id: blobId } });
    removed += 1;
  }

  return { assets: expired.length, blobs: removed };
}

export { AssetTooLargeError };
