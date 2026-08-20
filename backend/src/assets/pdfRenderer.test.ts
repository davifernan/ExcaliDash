import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  DEFAULT_LIMITS,
  PdfRejectedError,
  inspectPdf,
  parsePdfInfo,
  renderPage,
  withWhiteBackground,
} from "./pdfRenderer";

const run = promisify(execFile);

/** Build a small real PDF, so the tests exercise the actual tools. */
async function makePdf(dir: string, pages: number): Promise<string> {
  const html = join(dir, "doc.html");
  const pdf = join(dir, "doc.pdf");
  const body = Array.from(
    { length: pages },
    (_, i) =>
      `<h1>Page ${i + 1}</h1><p>Some body text.</p><div style="page-break-after:always"></div>`,
  ).join("");
  await writeFile(html, `<html><body>${body}</body></html>`);
  await run("weasyprint", [html, pdf]);
  return pdf;
}

const havePoppler = await run("pdfinfo", ["-v"])
  .then(() => true)
  .catch(() => false);
const haveWeasy = await run("weasyprint", ["--version"])
  .then(() => true)
  .catch(() => false);

describe("reading pdfinfo output", () => {
  it("picks out the page count and page size", () => {
    const info = parsePdfInfo(
      "Title:          Report\nPages:          12\nPage size:      595.276 x 841.89 pts (A4)\nEncrypted:      no\n",
    );
    expect(info.pageCount).toBe(12);
    expect(info.maxPageWidth).toBeCloseTo(595.276);
    expect(info.maxPageHeight).toBeCloseTo(841.89);
    expect(info.encrypted).toBe(false);
  });

  it("notices a protected document", () => {
    const info = parsePdfInfo("Pages:          3\nEncrypted:      yes (print:no copy:no)\n");
    expect(info.encrypted).toBe(true);
  });

  it("refuses output with no usable page count", () => {
    expect(() => parsePdfInfo("Title: not a pdf\n")).toThrow(PdfRejectedError);
    expect(() => parsePdfInfo("Pages:          0\n")).toThrow(PdfRejectedError);
    expect(() => parsePdfInfo("Pages:          many\n")).toThrow(PdfRejectedError);
  });

  it("survives a document that reports no page size", () => {
    const info = parsePdfInfo("Pages:          1\n");
    expect(info.pageCount).toBe(1);
    expect(info.maxPageWidth).toBe(0);
  });
});

describe("painting the page white", () => {
  it("puts a backdrop behind the drawing", () => {
    const svg = Buffer.from(
      '<?xml version="1.0"?>\n<svg width="100" height="200" viewBox="0 0 100 200"><path d="M0 0"/></svg>',
    );
    const out = withWhiteBackground(svg).toString();
    expect(out).toContain('<rect x="0" y="0" width="100" height="200" fill="#ffffff"/>');
    // Behind, not in front.
    expect(out.indexOf("<rect")).toBeLessThan(out.indexOf("<path"));
  });

  it("leaves something that is not an svg alone", () => {
    const notSvg = Buffer.from("just bytes");
    expect(withWhiteBackground(notSvg).toString()).toBe("just bytes");
  });

  it("leaves an svg without dimensions alone rather than guessing", () => {
    const svg = Buffer.from('<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>');
    expect(withWhiteBackground(svg).toString()).not.toContain("<rect");
  });
});

describe.skipIf(!havePoppler || !haveWeasy)("against real documents", () => {
  it("reports how many pages a document has", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pdftest-"));
    try {
      const pdf = await makePdf(dir, 5);
      const info = await inspectPdf(pdf);
      expect(info.pageCount).toBe(5);
      expect(info.encrypted).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a document with more pages than allowed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pdftest-"));
    try {
      const pdf = await makePdf(dir, 5);
      await expect(inspectPdf(pdf, { ...DEFAULT_LIMITS, maxPages: 2 })).rejects.toThrow(
        /5 pages; the limit is 2/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses something that is not a PDF at all", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pdftest-"));
    try {
      const fake = join(dir, "fake.pdf");
      await writeFile(fake, "I am not a PDF");
      await expect(inspectPdf(fake)).rejects.toThrow(/could not be read/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("renders a page as vector output with a white backdrop", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pdftest-"));
    try {
      const pdf = await makePdf(dir, 3);
      const page = await renderPage(pdf, 2);
      expect(page.mimeType).toBe("image/svg+xml");
      const text = page.body.toString();
      expect(text).toContain("<svg");
      expect(text).toContain('fill="#ffffff"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to a raster image when vector output would be huge", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pdftest-"));
    try {
      const pdf = await makePdf(dir, 1);
      // A limit no real page can stay under forces the fallback path.
      const page = await renderPage(pdf, 1, { ...DEFAULT_LIMITS, svgFallbackBytes: 10 });
      expect(page.mimeType).toBe("image/png");
      expect(page.body.subarray(1, 4).toString()).toBe("PNG");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a page number that is not a positive whole number", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pdftest-"));
    try {
      const pdf = await makePdf(dir, 1);
      await expect(renderPage(pdf, 0)).rejects.toThrow(/positive whole number/);
      await expect(renderPage(pdf, -1)).rejects.toThrow(/positive whole number/);
      await expect(renderPage(pdf, 1.5)).rejects.toThrow(/positive whole number/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a page that does not exist rather than returning nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pdftest-"));
    try {
      const pdf = await makePdf(dir, 2);
      await expect(renderPage(pdf, 99)).rejects.toThrow(PdfRejectedError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves nothing behind in the temp directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pdftest-"));
    try {
      const pdf = await makePdf(dir, 1);
      const { readdir } = await import("node:fs/promises");
      const before = (await readdir(tmpdir())).filter((n) => n.startsWith("pdfpage-")).length;
      await renderPage(pdf, 1);
      await renderPage(pdf, 99).catch(() => {});
      const after = (await readdir(tmpdir())).filter((n) => n.startsWith("pdfpage-")).length;
      expect(after).toBe(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
