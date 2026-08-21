const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export const getShareLinkToken = (hash?: string): string | null => {
  const fragment = hash ?? (typeof window !== "undefined" ? window.location.hash : "");
  const token = new URLSearchParams(fragment.replace(/^#/, "")).get("shareToken")?.trim() ?? "";
  return SHARE_TOKEN_PATTERN.test(token) ? token : null;
};

export const buildShareLinkUrl = (origin: string, drawingId: string, token: string): string => {
  if (!SHARE_TOKEN_PATTERN.test(token)) throw new Error("Invalid share token");
  return `${origin}/shared/${encodeURIComponent(drawingId)}#shareToken=${encodeURIComponent(token)}`;
};

export const addShareTokenToUrl = (url: string, token = getShareLinkToken()): string => {
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}shareToken=${encodeURIComponent(token)}`;
};
