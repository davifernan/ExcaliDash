import { describe, expect, it } from "vitest";
import { renderSafeMarkdown } from "./renderMarkdown";

const asDocument = (markdown: string) => {
  const container = document.createElement("div");
  container.innerHTML = renderSafeMarkdown(markdown);
  return container;
};

describe("safe Markdown rendering", () => {
  it("removes scripts and event handlers from raw HTML", () => {
    const rendered = asDocument(
      '# Heading\n<script>window.pwned = true</script><b onclick="alert(1)">safe</b>',
    );

    expect(rendered.querySelector("script")).toBeNull();
    expect(rendered.querySelector("[onclick]")).toBeNull();
    expect(rendered.textContent).toContain("safe");
  });

  it("removes javascript links while retaining allowed protocols", () => {
    const rendered = asDocument(
      "[bad](javascript:alert(1)) [web](https://example.com) [mail](mailto:a@example.com)",
    );
    const links = rendered.querySelectorAll("a");

    expect(rendered.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(links[0]).not.toHaveAttribute("href");
    expect(rendered.querySelector('a[href="https://example.com"]')).not.toBeNull();
    expect(rendered.querySelector('a[href="mailto:a@example.com"]')).not.toBeNull();
  });

  it("renders GFM tables and common document structure", () => {
    const rendered = asDocument("## Plan\n\n- **one**\n\n| A | B |\n| - | - |\n| 1 | `two` |");
    expect(rendered.querySelector("h2")?.textContent).toBe("Plan");
    expect(rendered.querySelector("li strong")?.textContent).toBe("one");
    expect(rendered.querySelector("table code")?.textContent).toBe("two");
  });
});
