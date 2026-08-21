/**
 * Turning a PDF into something a browser can draw.
 *
 * Pages come out as SVG rather than as a raster image. Measured on real
 * documents: a text page is 12 KB compressed as SVG against 127 KB as PNG, a
 * graphics-heavy one 55 KB against 204 KB. The bigger win is that there is no
 * resolution to choose — the same file stays sharp at any zoom, so a widget
 * someone drags larger does not turn to mush and no second size is needed for a
 * thumbnail.
 *
 * A scanned page is a photograph, and an SVG would embed that photograph and
 * come out larger. Those fall back to a raster image, decided per page.
 *
 * Everything here runs against files somebody else produced, which is the part
 * to be careful with: a small PDF can unpack into an enormous one, and the
 * renderers have a history of crashing on malformed input. Each run is a
 * separate short-lived process with its own limits, so a bad document takes
 * down one render and nothing else.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Bumped whenever output changes, so cached pages from an older renderer are not served. */
export const RENDERER_VERSION = "poppler-1";

export type PdfInfo = {
  pageCount: number;
  encrypted: boolean;
  /** First page in points; every requested page is checked again before rendering. */
  maxPageWidth: number;
  maxPageHeight: number;
};

export type RenderedPage = {
  body: Buffer;
  mimeType: "image/svg+xml" | "image/png";
};

export class PdfRejectedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "PdfRejectedError";
  }
}

export type RenderLimits = {
  /** Wall clock for a single page. */
  timeoutMs: number;
  /** Ceiling on a rendered page before falling back or giving up. */
  maxOutputBytes: number;
  /** Refuse documents with more pages than this. */
  maxPages: number;
  /** Refuse pages larger than this in points (72 per inch). */
  maxPagePoints: number;
  /** An SVG larger than this is a scan in disguise; use a raster image instead. */
  svgFallbackBytes: number;
};

export const DEFAULT_LIMITS: RenderLimits = {
  timeoutMs: 30_000,
  maxOutputBytes: 24 * 1024 * 1024,
  maxPages: 2000,
  // 200 inches. Larger than any real page, small enough to stop a document
  // whose only purpose is to make the renderer allocate.
  maxPagePoints: 14_400,
  svgFallbackBytes: 1024 * 1024,
};

/**
 * Parse `pdfinfo` output.
 *
 * Kept separate from running it so the parsing can be tested without a
 * subprocess, and so a surprising line in the output is a parse failure rather
 * than a wrong number quietly flowing onward.
 */
export function parsePdfInfo(stdout: string): PdfInfo {
  const field = (name: string) => {
    const line = stdout.split("\n").find((l) => l.startsWith(`${name}:`));
    return line ? line.slice(name.length + 1).trim() : null;
  };

  const pages = Number(field("Pages"));
  if (!Number.isInteger(pages) || pages < 1) {
    throw new PdfRejectedError("This file does not look like a readable PDF.");
  }

  // "Page size: 595.276 x 841.89 pts (A4)". Without a page range pdfinfo
  // reports only the first page; renderPage separately inspects the requested
  // page's MediaBox before starting either renderer.
  const size = field("Page size");
  const match = size?.match(/([\d.]+)\s*x\s*([\d.]+)/);
  const width = match ? Number(match[1]) : 0;
  const height = match ? Number(match[2]) : 0;

  return {
    pageCount: pages,
    encrypted: (field("Encrypted") ?? "no").toLowerCase().startsWith("yes"),
    maxPageWidth: Number.isFinite(width) ? width : 0,
    maxPageHeight: Number.isFinite(height) ? height : 0,
  };
}

/** Parse the requested page's MediaBox from `pdfinfo -box` output. */
export function parsePdfPageBox(stdout: string, page: number): { width: number; height: number } {
  const line = stdout
    .split("\n")
    .find((candidate) => new RegExp(`^Page\\s+${page}\\s+MediaBox:`).test(candidate));
  const coordinates = line
    ?.slice(line.indexOf(":") + 1)
    .trim()
    .split(/\s+/)
    .map(Number);
  if (
    !coordinates ||
    coordinates.length !== 4 ||
    coordinates.some((coordinate) => !Number.isFinite(coordinate))
  ) {
    throw new PdfRejectedError(`The dimensions of page ${page} could not be determined safely.`);
  }
  return {
    width: Math.abs(coordinates[2] - coordinates[0]),
    height: Math.abs(coordinates[3] - coordinates[1]),
  };
}

async function assertPageSize(
  path: string,
  page: number,
  limits: RenderLimits,
  signal?: AbortSignal,
): Promise<void> {
  let stdout: string;
  try {
    ({ stdout } = await run("pdfinfo", ["-box", "-f", String(page), "-l", String(page), path], {
      timeout: limits.timeoutMs,
      maxBuffer: 1024 * 1024,
      signal,
    }));
  } catch {
    throw new PdfRejectedError(`Page ${page} of this PDF could not be inspected.`);
  }
  const size = parsePdfPageBox(stdout, page);
  if (size.width > limits.maxPagePoints || size.height > limits.maxPagePoints) {
    throw new PdfRejectedError(`Page ${page} is far larger than any printable size.`);
  }
}

/** Read a document's shape, refusing anything we will not be able to serve. */
export async function inspectPdf(
  path: string,
  limits: RenderLimits = DEFAULT_LIMITS,
): Promise<PdfInfo> {
  let stdout: string;
  try {
    ({ stdout } = await run("pdfinfo", [path], {
      timeout: limits.timeoutMs,
      maxBuffer: 1024 * 1024,
    }));
  } catch {
    throw new PdfRejectedError("This PDF could not be read. It may be damaged.");
  }

  const info = parsePdfInfo(stdout);
  if (info.encrypted) {
    throw new PdfRejectedError(
      "This PDF is password protected. Remove the protection and upload it again.",
    );
  }
  if (info.pageCount > limits.maxPages) {
    throw new PdfRejectedError(
      `This PDF has ${info.pageCount} pages; the limit is ${limits.maxPages}.`,
    );
  }
  if (info.maxPageWidth > limits.maxPagePoints || info.maxPageHeight > limits.maxPagePoints) {
    throw new PdfRejectedError("This PDF has pages far larger than any printable size.");
  }
  return info;
}

/**
 * Render one page.
 *
 * SVG first, raster as the fallback for pages that are really photographs.
 * Both go through a fresh process with a timeout, so a document that makes the
 * renderer spin costs one page and then stops.
 */
export async function renderPage(
  path: string,
  page: number,
  limits: RenderLimits = DEFAULT_LIMITS,
  signal?: AbortSignal,
): Promise<RenderedPage> {
  if (!Number.isInteger(page) || page < 1) {
    throw new PdfRejectedError(`Page must be a positive whole number, got ${page}.`);
  }

  await assertPageSize(path, page, limits, signal);

  const dir = await mkdtemp(join(tmpdir(), "pdfpage-"));
  try {
    const svgPath = join(dir, "page.svg");
    try {
      await run("pdftocairo", ["-svg", "-f", String(page), "-l", String(page), path, svgPath], {
        timeout: limits.timeoutMs,
        maxBuffer: 1024 * 64,
        signal,
      });
      const svg = await readFile(svgPath);
      if (svg.length > limits.maxOutputBytes) {
        throw new PdfRejectedError("This page is too complex to display.");
      }
      if (svg.length <= limits.svgFallbackBytes) {
        return { body: withWhiteBackground(svg), mimeType: "image/svg+xml" };
      }
      // Too big for vector output: almost always a scan, where a raster image
      // is both smaller and just as good.
    } catch (err) {
      if (err instanceof PdfRejectedError) throw err;
      // Fall through to raster: some pages defeat the vector path entirely.
    }

    const pngPrefix = join(dir, "page");
    await run(
      "pdftoppm",
      ["-png", "-r", "110", "-f", String(page), "-l", String(page), "-singlefile", path, pngPrefix],
      { timeout: limits.timeoutMs, maxBuffer: 1024 * 64, signal },
    );
    const png = await readFile(`${pngPrefix}.png`);
    if (png.length > limits.maxOutputBytes) {
      throw new PdfRejectedError("This page is too large to display.");
    }
    return { body: png, mimeType: "image/png" };
  } catch (err) {
    if (err instanceof PdfRejectedError) throw err;
    throw new PdfRejectedError(`Page ${page} of this PDF could not be rendered.`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Paint the page white.
 *
 * pdftocairo leaves the background transparent, so a page would take on the
 * canvas colour behind it and look like a floating cut-out rather than paper.
 */
export function withWhiteBackground(svg: Buffer): Buffer {
  const text = svg.toString("utf8");
  const openTag = text.match(/<svg\b[^>]*>/);
  if (!openTag) return svg;

  const attrs = openTag[0];
  const width = attrs.match(/\bwidth="([\d.]+)/)?.[1];
  const height = attrs.match(/\bheight="([\d.]+)/)?.[1];
  if (!width || !height) return svg;

  const insertAt = (openTag.index ?? 0) + attrs.length;
  const backdrop = `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`;
  return Buffer.from(text.slice(0, insertAt) + backdrop + text.slice(insertAt), "utf8");
}
