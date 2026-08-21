import type { Readable } from "node:stream";

export const MAX_TEXT_UPLOAD_BYTES = 2 * 1024 * 1024;

export class InvalidTextDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTextDocumentError";
  }
}

/**
 * Validate text without buffering it. The decoder keeps incomplete multibyte
 * sequences between chunks, while the original bytes continue to storage.
 */
export async function* validatedTextUpload(source: Readable): AsyncGenerator<Buffer> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for await (const value of source) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      if (chunk.includes(0)) {
        throw new InvalidTextDocumentError("Text documents must not contain null bytes.");
      }
      decoder.decode(chunk, { stream: true });
      yield chunk;
    }
    decoder.decode();
  } catch (error) {
    if (error instanceof InvalidTextDocumentError) throw error;
    if (error instanceof TypeError) {
      throw new InvalidTextDocumentError("Text documents must contain valid UTF-8.");
    }
    throw error;
  }
}
