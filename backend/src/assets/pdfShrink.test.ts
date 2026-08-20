import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describeShrink, shouldTryShrink, shrinkPdf } from "./pdfShrink";

const run = promisify(execFile);
const haveGs = await run("gs", ["--version"])
  .then(() => true)
  .catch(() => false);
const haveWeasy = await run("weasyprint", ["--version"])
  .then(() => true)
  .catch(() => false);

const opts = (over = {}) => ({ level: "printer" as const, minBytes: 0, ...over });

describe("deciding whether to try", () => {
  it("leaves small files alone", () => {
    expect(shouldTryShrink(1000, opts({ minBytes: 5000 }))).toBe(false);
    expect(shouldTryShrink(9000, opts({ minBytes: 5000 }))).toBe(true);
  });

  it("does nothing when switched off", () => {
    expect(shouldTryShrink(50_000_000, opts({ level: "off" }))).toBe(false);
  });
});

describe("describing the result", () => {
  it("says how much was saved", () => {
    expect(
      describeShrink({
        applied: true,
        originalBytes: 13_000_000,
        finalBytes: 4_100_000,
        reason: "smaller",
      }),
    ).toBe("Optimised from 12.4 MB to 3.9 MB (68% smaller).");
  });

  it("says nothing when the file was left alone", () => {
    expect(
      describeShrink({
        applied: false,
        originalBytes: 100,
        finalBytes: 100,
        reason: "not-smaller",
      }),
    ).toBeNull();
  });
});

describe.skipIf(!haveGs)("rebuilding a document", () => {
  it("reports disabled without touching the file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shrinktest-"));
    try {
      const path = join(dir, "doc.pdf");
      await writeFile(path, "%PDF-1.4 not really");
      const before = (await stat(path)).size;

      const result = await shrinkPdf(path, opts({ level: "off" }));
      expect(result.reason).toBe("disabled");
      expect((await stat(path)).size).toBe(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves a file below the threshold alone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shrinktest-"));
    try {
      const path = join(dir, "doc.pdf");
      await writeFile(path, "%PDF-1.4 small");
      const result = await shrinkPdf(path, opts({ minBytes: 1_000_000 }));
      expect(result.reason).toBe("too-small");
      expect(result.applied).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a document Ghostscript cannot read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shrinktest-"));
    try {
      const path = join(dir, "doc.pdf");
      await writeFile(path, "this is not a PDF at all, not even close");
      const before = (await stat(path)).size;

      const result = await shrinkPdf(path, opts());
      expect(result.reason).toBe("failed");
      expect(result.applied).toBe(false);
      expect((await stat(path)).size).toBe(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!haveGs || !haveWeasy)("against a real document", () => {
  const makePdf = async (dir: string) => {
    const html = join(dir, "d.html");
    const pdf = join(dir, "d.pdf");
    // Text only: rebuilding this makes it bigger, which is the case that must
    // not silently replace the upload.
    await writeFile(
      html,
      `<html><body>${"<p>Lorem ipsum dolor sit amet.</p>".repeat(400)}</body></html>`,
    );
    await run("weasyprint", [html, pdf]);
    return pdf;
  };

  it("does not replace a document that would grow", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shrinktest-"));
    try {
      const source = await makePdf(dir);
      const path = join(dir, "copy.pdf");
      await copyFile(source, path);
      const before = (await stat(path)).size;

      const result = await shrinkPdf(path, opts());
      if (result.applied) {
        // If it did shrink, it must genuinely be smaller.
        expect(result.finalBytes).toBeLessThan(before);
      } else {
        expect(result.reason).toBe("not-smaller");
        expect((await stat(path)).size).toBe(before);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves a readable document readable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shrinktest-"));
    try {
      const source = await makePdf(dir);
      const path = join(dir, "copy.pdf");
      await copyFile(source, path);
      await shrinkPdf(path, opts());

      // Whatever happened, the file must still be a PDF poppler can read.
      const { stdout } = await run("pdfinfo", [path]);
      expect(stdout).toMatch(/Pages:\s+\d+/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
