import { JSDOM } from "jsdom";
import { PreviewFetchError } from "./network";

export type LinkMetadata = {
  title: string | null;
  description: string | null;
  imageUrl: URL | null;
  faviconUrl: URL | null;
};

const MAX_TITLE_CHARS = 300;
const MAX_DESCRIPTION_CHARS = 1_000;

function decodeHtml(bytes: Buffer): string {
  if (bytes.includes(0)) {
    throw new PreviewFetchError("NOT_HTML", "The response contains binary data, not HTML.");
  }
  let html: string;
  try {
    html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PreviewFetchError("NOT_HTML", "The response is not valid UTF-8 HTML.");
  }
  const sample = html.replace(/^\uFEFF?\s*/, "").slice(0, 4_096);
  if (!sample.startsWith("<") || !/<(?:!doctype\s+html|html|head|title|meta)\b/i.test(sample)) {
    throw new PreviewFetchError("NOT_HTML", "The response does not look like an HTML document.");
  }
  return html;
}

function cleanText(document: Document, value: string | null, limit: number): string | null {
  if (!value) return null;
  const holder = document.createElement("template");
  holder.innerHTML = value;
  const text = (holder.content.textContent ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return Array.from(text).slice(0, limit).join("");
}

function metaContent(
  document: Document,
  attribute: "property" | "name",
  key: string,
): string | null {
  for (const element of document.head.querySelectorAll("meta")) {
    if (element.getAttribute(attribute)?.trim().toLowerCase() === key) {
      return element.getAttribute("content");
    }
  }
  return null;
}

function firstMeta(
  document: Document,
  candidates: Array<["property" | "name", string]>,
): string | null {
  for (const [attribute, key] of candidates) {
    const value = metaContent(document, attribute, key);
    if (value) return value;
  }
  return null;
}

function safeRemoteUrl(value: string | null, base: URL): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim(), base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function findFavicon(document: Document, base: URL): URL | null {
  const links = Array.from(document.head.querySelectorAll("link[href]"));
  const icon = links.find((link) =>
    (link.getAttribute("rel") ?? "")
      .toLowerCase()
      .split(/\s+/)
      .some((part) => part === "icon" || part === "apple-touch-icon"),
  );
  return safeRemoteUrl(icon?.getAttribute("href") ?? "/favicon.ico", base);
}

/** Parse only the bounded head fragment and return inert, length-limited values. */
export function extractLinkMetadata(bytes: Buffer, finalUrl: URL): LinkMetadata {
  const html = decodeHtml(bytes);
  const dom = new JSDOM(html, { url: finalUrl.href });
  const { document } = dom.window;

  const titleRaw =
    firstMeta(document, [
      ["property", "og:title"],
      ["name", "twitter:title"],
    ]) ?? document.title;
  const descriptionRaw = firstMeta(document, [
    ["property", "og:description"],
    ["name", "twitter:description"],
    ["name", "description"],
  ]);
  const imageRaw = firstMeta(document, [
    ["property", "og:image:secure_url"],
    ["property", "og:image"],
    ["name", "twitter:image"],
    ["name", "twitter:image:src"],
  ]);

  const result = {
    title: cleanText(document, titleRaw, MAX_TITLE_CHARS),
    description: cleanText(document, descriptionRaw, MAX_DESCRIPTION_CHARS),
    imageUrl: safeRemoteUrl(imageRaw, finalUrl),
    faviconUrl: findFavicon(document, finalUrl),
  };
  dom.window.close();
  return result;
}
