import { describe, expect, it } from "vitest";
import { DOCUMENT_PAGE_CHAR_BUDGET, paginateDocumentSource } from "./documentPagination";

describe("document source pagination", () => {
  it("never cuts a fenced code block at a page boundary", () => {
    const fence = `\`\`\`ts\n${"const value = 1;\n".repeat(8)}\`\`\`\n`;
    const source = `${"intro ".repeat(8)}\n\n${fence}\nAfter the fence.`;

    const pages = paginateDocumentSource(source, "MARKDOWN", 80);

    expect(pages).toHaveLength(3);
    expect(pages.filter((page) => page.includes("const value"))).toEqual([fence]);
    expect(pages.some((page) => page.startsWith("```ts") && page.endsWith("```\n"))).toBe(true);
  });

  it("repeats a table header and separator when a table spans pages", () => {
    const prefix = "| Name | Value |\n| --- | ---: |\n";
    const rows = Array.from({ length: 12 }, (_, index) => `| row ${index} | ${index} |\n`).join("");

    const pages = paginateDocumentSource(prefix + rows, "MARKDOWN", 100);

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.startsWith(prefix))).toBe(true);
    expect(pages.join("\n")).toContain("| row 11 | 11 |");
  });

  it("keeps an oversized block on one non-empty page", () => {
    const source = `~~~text\n${"one very long code line ".repeat(40)}\n~~~`;

    const pages = paginateDocumentSource(source, "MARKDOWN", 80);

    expect(pages).toEqual([source]);
    expect(pages.every((page) => page.length > 0)).toBe(true);
  });

  it("does not create a blank page before an oversized block", () => {
    const fence = `\`\`\`\n${"large block\n".repeat(20)}\`\`\``;
    const source = `${"x".repeat(80)}\n\n${fence}`;

    const pages = paginateDocumentSource(source, "MARKDOWN", 80);

    expect(pages).toEqual([`${"x".repeat(80)}\n`, fence]);
    expect(pages.every((page) => page.trim().length > 0)).toBe(true);
  });

  it("splits a long list only between complete list items", () => {
    const items = Array.from(
      { length: 8 },
      (_, index) => `- item ${index}\n  continuation ${index}\n`,
    );

    const pages = paginateDocumentSource(items.join(""), "MARKDOWN", 75);

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => !page.startsWith("  continuation"))).toBe(true);
    expect(pages.join("")).toBe(items.join(""));
  });

  it("does not mistake list-looking code for a new list item", () => {
    const fencedItem = `- example\n  \`\`\`\n- this is code\n${"code\n".repeat(20)}  \`\`\`\n`;
    const source = `${fencedItem}- actual next item\n`;

    const pages = paginateDocumentSource(source, "MARKDOWN", 80);

    expect(pages.filter((page) => page.includes("this is code"))).toEqual([fencedItem]);
  });

  it("splits plain text at line endings", () => {
    const source = "first line\nsecond line\nthird line\n";
    const pages = paginateDocumentSource(source, "TEXT", 20);

    expect(pages).toEqual(["first line\n", "second line\n", "third line\n"]);
    expect(pages.join("")).toBe(source);
  });

  it("bounds pages from a pathological 500,000-row table in linear time", () => {
    const header = "| Value |\n| --- |\n";
    const source = `${header}${"| cell |\n".repeat(500_000)}`;
    const started = performance.now();

    const pages = paginateDocumentSource(source, "MARKDOWN");
    const elapsedMs = performance.now() - started;

    expect(elapsedMs).toBeLessThan(5_000);
    expect(pages.length).toBeGreaterThan(200);
    expect(pages.every((page) => page.startsWith(header))).toBe(true);
    expect(pages.every((page) => page.length <= DOCUMENT_PAGE_CHAR_BUDGET)).toBe(true);
  });
});
