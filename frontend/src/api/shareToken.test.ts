import { describe, expect, it } from "vitest";
import { api } from "./client";
import { addShareTokenToUrl, buildShareLinkUrl, getShareLinkToken } from "./shareToken";

describe("share-link URL helpers", () => {
  const token = "aB_1-".repeat(7).slice(0, 32);

  it("reads only a correctly shaped token", () => {
    expect(getShareLinkToken(`#shareToken=${token}`)).toBe(token);
    expect(getShareLinkToken("#shareToken=short")).toBeNull();
    expect(getShareLinkToken("")).toBeNull();
  });

  it("builds a public editor URL containing the secret", () => {
    expect(buildShareLinkUrl("https://dash.example", "drawing 1", token)).toBe(
      `https://dash.example/shared/drawing%201#shareToken=${token}`,
    );
  });

  it("adds the token to direct document URLs", () => {
    expect(addShareTokenToUrl("/api/document", token)).toBe(`/api/document?shareToken=${token}`);
    expect(addShareTokenToUrl("/api/document?page=1", token)).toBe(
      `/api/document?page=1&shareToken=${token}`,
    );
  });

  it("adds the current share secret to API request headers", async () => {
    window.history.replaceState(null, "", `/shared/drawing-1#shareToken=${token}`);
    let requestHeaders: unknown;

    await api.get("/drawings/drawing-1", {
      adapter: async (config) => {
        requestHeaders = config.headers;
        return { data: {}, status: 200, statusText: "OK", headers: {}, config };
      },
    });

    expect((requestHeaders as { get: (name: string) => string }).get("X-Share-Token")).toBe(token);
    window.history.replaceState(null, "", "/");
  });
});
