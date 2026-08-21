import { describe, expect, it, vi } from "vitest";
import { registerLinkPreviewRoutes } from "./routes";

function routeHarness(requireAuth: any, getPreview: any) {
  const routes = new Map<string, any[]>();
  const app = {
    post: (path: string, ...handlers: any[]) => routes.set(`POST ${path}`, handlers),
    get: (path: string, ...handlers: any[]) => routes.set(`GET ${path}`, handlers),
  };
  registerLinkPreviewRoutes({
    app: app as any,
    prisma: {},
    storageDir: "/unused",
    getPreview,
    asyncHandler: (fn: any) => fn,
    requireAuth,
  });
  const req: any = { body: { url: "https://example.com" }, headers: {} };
  const res: any = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
  const invokePost = async () => {
    const [auth, handler] = routes.get("POST /link-previews")!;
    let nextCalled = false;
    await auth(req, res, () => {
      nextCalled = true;
    });
    if (nextCalled) await handler(req, res);
    return res;
  };
  return { req, invokePost };
}

describe("link preview routes", () => {
  it("does not invoke the preview service for signed-out callers", async () => {
    const getPreview = vi.fn();
    const harness = routeHarness(
      (_req: any, res: any) => res.status(401).json({ error: "Unauthorized" }),
      getPreview,
    );

    expect((await harness.invokePost()).statusCode).toBe(401);
    expect(getPreview).not.toHaveBeenCalled();
  });

  it("returns only local URLs for mirrored resources", async () => {
    const harness = routeHarness(
      (req: any, _res: any, next: any) => {
        req.user = { id: "user-1" };
        next();
      },
      async () => ({
        id: "00000000-0000-0000-0000-000000000001",
        status: "READY",
        failureCode: null,
        requestedUrl: "https://example.com",
        resolvedUrl: "https://example.com/final",
        title: "Example",
        description: null,
        imageBlobId: "blob-image",
        faviconBlobId: "blob-icon",
      }),
    );

    const result = await harness.invokePost();
    expect(result.body.imageUrl).toBe(
      "/api/link-previews/00000000-0000-0000-0000-000000000001/image",
    );
    expect(result.body.faviconUrl).not.toContain("example.com");
  });
});
