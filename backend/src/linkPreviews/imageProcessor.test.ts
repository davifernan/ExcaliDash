import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  imageMagickResourceArgs,
  parseImageIdentity,
  sanitizePreviewImage,
  sniffRasterFormat,
  type ImageLimits,
} from "./imageProcessor";

const run = promisify(execFile);

const limits: ImageLimits = {
  maxPixels: 16_000_000,
  maxDimension: 2_048,
  maxOutputBytes: 2_000_000,
  timeoutMs: 1_000,
};

const haveImageMagick = await run("convert", ["-version"])
  .then(() => true)
  .catch(() => false);

describe("preview image admission", () => {
  it("uses magic bytes rather than the claimed MIME type", () => {
    expect(sniffRasterFormat(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe("png");
    expect(sniffRasterFormat(Buffer.from([0, 0, 1, 0, 1, 0]))).toBe("ico");
    expect(sniffRasterFormat(Buffer.from("<svg><script/></svg>"))).toBeNull();
    expect(sniffRasterFormat(Buffer.from("not an image"))).toBeNull();
  });

  it("rejects images over the decoded pixel limit", () => {
    expect(() => parseImageIdentity("PNG 5000 5000", limits)).toThrow(/pixel limit/);
  });

  it("rejects animated images rather than hiding extra frames", () => {
    expect(() => parseImageIdentity("GIF 100 100\nGIF 100 100", limits)).toThrow(/Animated/);
  });

  it("places dimension, frame and thread limits in the decoder policy", () => {
    // Read as pairs. `arrayContaining` only asks whether each string appears
    // somewhere, so it cannot tell "list-length 1" from "list-length 2" — the
    // "1" belonging to the thread limit satisfies it either way, and this test
    // stayed green while the value it names was changed.
    const args = imageMagickResourceArgs(limits);
    const valueOf = (name: string) => args[args.indexOf(name) + 1];
    expect(valueOf("width")).toBe("2048");
    expect(valueOf("height")).toBe("2048");
    expect(valueOf("thread")).toBe("1");
    // 2 admits exactly one image. 1 admits none: ImageMagick refuses at the
    // limit, not above it, so every preview failed to re-encode.
    expect(valueOf("list-length")).toBe("2");
  });
});

describe.skipIf(!haveImageMagick)("preview images through real ImageMagick", () => {
  // ImageMagick refuses at the limit rather than above it, so list-length 2
  // admits exactly one image. Both of these are turned away by the decoder
  // before any frame is counted; the frame count in parseImageIdentity is the
  // second line of defence, not the first.
  it.each([[2], [3]])("turns away a real animated image of %i frames", async (frames) => {
    // The limit had to be raised from 1, because 1 rejected every single-image
    // file as well. This proves the raise did not let animations through.
    const dir = await mkdtemp(join(tmpdir(), "anim-"));
    try {
      const gif = join(dir, "anim.gif");
      const colours = ["xc:red", "xc:blue", "xc:green"].slice(0, frames);
      await run("convert", ["-delay", "10", "-size", "32x32", ...colours, gif]);
      await expect(sanitizePreviewImage(await readFile(gif), limits)).rejects.toThrow(
        /decoded safely/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("re-encodes to WebP and strips source metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "link-image-test-"));
    try {
      const source = join(dir, "source.jpg");
      await run("convert", [
        "-size",
        "20x10",
        "xc:#336699",
        "-set",
        "comment",
        "secret-metadata",
        "-set",
        "EXIF:Artist",
        "secret-metadata",
        source,
      ]);
      expect((await run("identify", ["-verbose", source])).stdout).toContain("secret-metadata");
      const output = await sanitizePreviewImage(await readFile(source), limits);
      const clean = join(dir, "clean.webp");
      await writeFile(clean, output);
      const identity = await run("identify", ["-format", "%m %w %h", clean]);
      expect(identity.stdout.trim()).toBe("WEBP 20 10");
      expect((await run("identify", ["-verbose", clean])).stdout).not.toContain("secret-metadata");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("enforces decoder dimensions before accepting the source", async () => {
    const dir = await mkdtemp(join(tmpdir(), "link-image-test-"));
    try {
      const source = join(dir, "source.png");
      await run("convert", ["-size", "64x32", "xc:red", source]);
      await expect(
        sanitizePreviewImage(await readFile(source), { ...limits, maxDimension: 32 }),
      ).rejects.toThrow(/decoded safely/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects over-limit output before returning it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "link-image-test-"));
    try {
      const source = join(dir, "source.png");
      await run("convert", ["-size", "10x10", "xc:red", source]);
      await expect(
        sanitizePreviewImage(await readFile(source), { ...limits, maxOutputBytes: 1 }),
      ).rejects.toThrow(/byte limit/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("kills ImageMagick when the processing deadline is exhausted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "link-image-test-"));
    try {
      const source = join(dir, "source.png");
      await run("convert", ["-size", "2000x2000", "plasma:fractal", source]);
      await expect(
        sanitizePreviewImage(await readFile(source), { ...limits, timeoutMs: 1 }),
      ).rejects.toThrow(/decoded safely|re-encoded safely/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
