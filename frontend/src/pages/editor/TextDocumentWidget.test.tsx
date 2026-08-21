import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDocumentAsset, getDocumentContent } from "../../api";
import { TextDocumentWidget } from "./TextDocumentWidget";

vi.mock("../../api", () => ({
  getDocumentAsset: vi.fn(),
  getDocumentContent: vi.fn(),
  getDocumentOriginalUrl: (drawingId: string, assetId: string) =>
    `/api/drawings/${drawingId}/assets/${assetId}/original`,
}));

describe("TextDocumentWidget", () => {
  beforeEach(() => {
    vi.mocked(getDocumentAsset).mockResolvedValue({
      id: "asset-1",
      kind: "MARKDOWN",
      name: "notes.md",
      sizeBytes: 100,
      pageCount: null,
    });
  });

  it("sanitizes raw HTML and unsafe Markdown links before insertion", async () => {
    vi.mocked(getDocumentContent).mockResolvedValue(
      "# Notes\n<script>window.pwned = true</script>\n[bad](javascript:alert(1))",
    );
    const { container } = render(
      <TextDocumentWidget
        assetId="asset-1"
        drawingId="drawing-1"
        theme="light"
        widgetKind="markdown"
      />,
    );

    await screen.findByText("Notes");
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("bad").closest("a")).not.toHaveAttribute("href");
  });

  it("renders plain text literally with preserved whitespace", async () => {
    vi.mocked(getDocumentAsset).mockResolvedValue({
      id: "asset-1",
      kind: "TEXT",
      name: "notes.txt",
      sizeBytes: 40,
      pageCount: null,
    });
    vi.mocked(getDocumentContent).mockResolvedValue("first line\n  <b>literal</b>");
    const { container } = render(
      <TextDocumentWidget
        assetId="asset-1"
        drawingId="drawing-1"
        theme="light"
        widgetKind="text"
      />,
    );

    const plain = await screen.findByText(/first line/);
    expect(plain.tagName).toBe("PRE");
    expect(plain.textContent).toBe("first line\n  <b>literal</b>");
    expect(container.querySelector("b")).toBeNull();
  });
});
