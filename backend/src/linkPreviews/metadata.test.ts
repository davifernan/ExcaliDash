import { describe, expect, it } from "vitest";
import { extractLinkMetadata } from "./metadata";

describe("link metadata extraction", () => {
  it("prefers OpenGraph, resolves URLs, and returns only bounded plain text", () => {
    const long = "z".repeat(2_000);
    const html = Buffer.from(`<!doctype html><html><head>
      <title>Fallback title</title>
      <meta property="og:title" content="&lt;b&gt;OG title&lt;/b&gt;">
      <meta property="og:description" content="&lt;img src=x onerror=alert(1)&gt;Safe ${long}">
      <meta property="og:image" content="/cover.png">
      <link rel="icon" href="icons/site.png">
    </head><body><script>not read</script></body></html>`);
    const result = extractLinkMetadata(html, new URL("https://example.com/articles/one"));

    expect(result.title).toBe("OG title");
    expect(result.description).toHaveLength(1_000);
    expect(result.description).not.toContain("<");
    expect(result.imageUrl?.href).toBe("https://example.com/cover.png");
    expect(result.faviconUrl?.href).toBe("https://example.com/articles/icons/site.png");
  });

  it("rejects binary bytes mislabeled by a server as HTML", () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]);
    expect(() => extractLinkMetadata(png, new URL("https://example.com"))).toThrow(/binary data/);
  });

  it("rejects ordinary text that merely arrived with text/html", () => {
    expect(() =>
      extractLinkMetadata(Buffer.from("this is not markup"), new URL("https://example.com")),
    ).toThrow(/does not look like/);
  });
});
