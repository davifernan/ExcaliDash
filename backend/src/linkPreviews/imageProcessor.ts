import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type ImageLimits = {
  maxPixels: number;
  maxDimension: number;
  maxOutputBytes: number;
  timeoutMs: number;
};

export class PreviewImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewImageError";
  }
}

type RasterFormat = "png" | "jpeg" | "gif" | "webp" | "ico";

/** Magic bytes, not a remote Content-Type, decide which decoder is allowed. */
export function sniffRasterFormat(bytes: Buffer): RasterFormat | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.subarray(0, 6).toString("ascii") === "GIF87a") return "gif";
  if (bytes.subarray(0, 6).toString("ascii") === "GIF89a") return "gif";
  if (bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return "ico";
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export function parseImageIdentity(
  raw: string,
  limits: ImageLimits,
  allowMultiple = false,
): { width: number; height: number } {
  const frames = raw
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (frames.length > 1 && !allowMultiple) {
    throw new PreviewImageError("Animated images are not accepted for previews.");
  }
  let width = 0;
  let height = 0;
  for (const frame of frames) {
    const match = frame.match(/^(PNG|JPEG|GIF|WEBP|ICO)\s+(\d+)\s+(\d+)$/i);
    if (!match) throw new PreviewImageError("The image decoder returned invalid dimensions.");
    const frameWidth = Number(match[2]);
    const frameHeight = Number(match[3]);
    if (
      !Number.isSafeInteger(frameWidth) ||
      !Number.isSafeInteger(frameHeight) ||
      frameWidth < 1 ||
      frameHeight < 1
    ) {
      throw new PreviewImageError("The image has invalid dimensions.");
    }
    if (frameWidth * frameHeight > limits.maxPixels) {
      throw new PreviewImageError("The image exceeds the pixel limit.");
    }
    width = Math.max(width, frameWidth);
    height = Math.max(height, frameHeight);
  }
  return { width, height };
}

/** Decode in a bounded child process, resize, re-encode, and deliberately keep no metadata. */
export async function sanitizePreviewImage(bytes: Buffer, limits: ImageLimits): Promise<Buffer> {
  const format = sniffRasterFormat(bytes);
  if (!format) throw new PreviewImageError("The response is not a supported raster image.");

  const dir = await mkdtemp(join(tmpdir(), "link-preview-"));
  const input = join(dir, `input.${format === "jpeg" ? "jpg" : format}`);
  const output = join(dir, "output.webp");
  const resourceArgs = [
    "-limit",
    "memory",
    "64MiB",
    "-limit",
    "map",
    "128MiB",
    "-limit",
    "disk",
    "0",
    "-limit",
    "area",
    String(limits.maxPixels),
  ];
  try {
    await writeFile(input, bytes, { mode: 0o600 });
    let identity: string;
    try {
      ({ stdout: identity } = await run(
        "identify",
        [...resourceArgs, "-ping", "-format", "%m %w %h\n", input],
        { timeout: limits.timeoutMs, maxBuffer: 64 * 1024 },
      ));
    } catch {
      throw new PreviewImageError("The image could not be decoded safely.");
    }
    parseImageIdentity(identity, limits, format === "ico");

    try {
      await run(
        "convert",
        [
          ...resourceArgs,
          `${input}[0]`,
          "-auto-orient",
          "-thumbnail",
          `${limits.maxDimension}x${limits.maxDimension}>`,
          "-strip",
          "-quality",
          "82",
          output,
        ],
        { timeout: limits.timeoutMs, maxBuffer: 64 * 1024 },
      );
    } catch {
      throw new PreviewImageError("The image could not be re-encoded safely.");
    }
    const sanitized = await readFile(output);
    if (sanitized.length < 1 || sanitized.length > limits.maxOutputBytes) {
      throw new PreviewImageError("The sanitized image exceeds the byte limit.");
    }
    return sanitized;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
