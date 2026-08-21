import { describe, expect, it } from "vitest";
import { requestedUploadPresentation } from "./assetRoutes";

describe("upload presentation preference", () => {
  it("uses the client media type rather than claiming to detect Markdown syntax", () => {
    expect(requestedUploadPresentation("text/markdown; charset=utf-8")).toMatchObject({
      mediaType: "text/markdown",
      presentation: { kind: "MARKDOWN" },
    });
    expect(requestedUploadPresentation("text/plain")).toMatchObject({
      mediaType: "text/plain",
      presentation: { kind: "TEXT" },
    });
  });
});
