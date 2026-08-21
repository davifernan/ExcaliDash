import DOMPurify from "dompurify";
import { marked } from "marked";

const MARKDOWN_TAGS = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
];

/** Parse GFM, then reduce the result to inert document markup. */
export const renderSafeMarkdown = (markdown: string): string => {
  const parsed = marked.parse(markdown, { async: false, gfm: true });
  return String(
    DOMPurify.sanitize(parsed, {
      ALLOWED_TAGS: MARKDOWN_TAGS,
      ALLOWED_ATTR: ["href", "title"],
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
      ALLOW_DATA_ATTR: false,
    }),
  );
};
