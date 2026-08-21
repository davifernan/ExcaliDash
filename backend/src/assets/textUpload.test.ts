import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { InvalidTextDocumentError, validatedTextUpload } from "./textUpload";

const collect = async (source: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of validatedTextUpload(source)) chunks.push(chunk);
  return Buffer.concat(chunks);
};

describe("text upload validation", () => {
  it("passes valid UTF-8 through byte-for-byte across chunk boundaries", async () => {
    const utf8 = Buffer.from("Grüße 👋");
    const result = await collect(Readable.from([utf8.subarray(0, 4), utf8.subarray(4)]));
    expect(result).toEqual(utf8);
  });

  it("rejects invalid UTF-8", async () => {
    await expect(collect(Readable.from([Buffer.from([0xc3, 0x28])]))).rejects.toThrow(
      InvalidTextDocumentError,
    );
  });

  it("rejects null bytes", async () => {
    await expect(collect(Readable.from([Buffer.from("notes\0hidden")]))).rejects.toThrow(
      /null bytes/,
    );
  });
});
