import { describe, expect, it } from "vitest";
import { parseImageIdentity, sniffRasterFormat, type ImageLimits } from "./imageProcessor";

const limits: ImageLimits = {
  maxPixels: 16_000_000,
  maxDimension: 2_048,
  maxOutputBytes: 2_000_000,
  timeoutMs: 1_000,
};

describe("preview image admission", () => {
  it("uses magic bytes rather than the claimed MIME type", () => {
    expect(sniffRasterFormat(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe("png");
    expect(sniffRasterFormat(Buffer.from([0, 0, 1, 0, 1, 0]))).toBe("ico");
    expect(sniffRasterFormat(Buffer.from("<svg><script/></svg>"))).toBeNull();
    expect(sniffRasterFormat(Buffer.from("not an image"))).toBeNull();
  });

  it("rejects images over the decoded pixel limit", () => {
    expect(() => parseImageIdentity("PNG 5000 5000", limits)).toThrow(/pixel limit/);
  });

  it("rejects animated images rather than hiding extra frames", () => {
    expect(() => parseImageIdentity("GIF 100 100\nGIF 100 100", limits)).toThrow(/Animated/);
  });
});
