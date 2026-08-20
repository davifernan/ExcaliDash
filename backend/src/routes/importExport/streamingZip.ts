import { createReadStream, promises as fs } from "node:fs";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";
import { ImportValidationError, assertSafeArchivePath, normalizeArchivePath } from "./shared";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_EOCD_BYTES = 65_557;

export type StreamingZipEntry = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  flags: number;
  crc32: number;
  localHeaderOffset: number;
  directory: boolean;
};

export type ExtractionBudget = {
  extractedBytes: number;
  maxExtractedBytes: number;
};

const readExact = async (
  handle: fs.FileHandle,
  length: number,
  position: number,
): Promise<Buffer> => {
  const buffer = Buffer.allocUnsafe(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new ImportValidationError("Truncated ZIP archive");
  return buffer;
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

const updateCrc32 = (current: number, chunk: Buffer): number => {
  let crc = current;
  for (const byte of chunk) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc >>> 0;
};

export class StreamingZipArchive {
  private constructor(
    readonly filePath: string,
    readonly fileSize: number,
    readonly entries: Map<string, StreamingZipEntry>,
    private readonly centralDirectoryOffset: number,
  ) {}

  static async open(
    filePath: string,
    limits: {
      maxArchiveBytes: number;
      maxEntries: number;
      maxEntryBytes: number;
      maxExtractedBytes: number;
    },
  ): Promise<StreamingZipArchive> {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new ImportValidationError("Backup archive is not a file");
    if (stat.size > limits.maxArchiveBytes) {
      throw new ImportValidationError("Backup archive exceeds maximum upload size", 413);
    }
    if (stat.size < 22) throw new ImportValidationError("Invalid ZIP archive");

    const handle = await fs.open(filePath, "r");
    try {
      const tailLength = Math.min(stat.size, MAX_EOCD_BYTES);
      const tailOffset = stat.size - tailLength;
      const tail = await readExact(handle, tailLength, tailOffset);
      let eocdOffset = -1;
      for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
        if (tail.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
        const commentLength = tail.readUInt16LE(offset + 20);
        if (offset + 22 + commentLength === tail.length) {
          eocdOffset = offset;
          break;
        }
      }
      if (eocdOffset < 0) throw new ImportValidationError("Invalid ZIP end record");

      const diskNumber = tail.readUInt16LE(eocdOffset + 4);
      const centralDisk = tail.readUInt16LE(eocdOffset + 6);
      const entriesOnDisk = tail.readUInt16LE(eocdOffset + 8);
      const entryCount = tail.readUInt16LE(eocdOffset + 10);
      const centralSize = tail.readUInt32LE(eocdOffset + 12);
      const centralOffset = tail.readUInt32LE(eocdOffset + 16);
      if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
        throw new ImportValidationError("Multi-disk ZIP archives are not supported");
      }
      if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
        throw new ImportValidationError("ZIP64 archives are not supported");
      }
      if (entryCount > limits.maxEntries) {
        throw new ImportValidationError("Archive contains too many files");
      }
      const maxCentralBytes = Math.min(limits.maxArchiveBytes, limits.maxEntries * 4096 + 46);
      if (centralSize > maxCentralBytes) {
        throw new ImportValidationError("ZIP directory is too large");
      }
      if (centralOffset + centralSize > tailOffset + eocdOffset) {
        throw new ImportValidationError("Invalid ZIP directory bounds");
      }

      const central = await readExact(handle, centralSize, centralOffset);
      const entries = new Map<string, StreamingZipEntry>();
      let cursor = 0;
      let declaredExtractedBytes = 0;
      for (let index = 0; index < entryCount; index += 1) {
        if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
          throw new ImportValidationError("Invalid ZIP directory entry");
        }
        const flags = central.readUInt16LE(cursor + 8);
        const compressionMethod = central.readUInt16LE(cursor + 10);
        const crc32 = central.readUInt32LE(cursor + 16);
        const compressedSize = central.readUInt32LE(cursor + 20);
        const uncompressedSize = central.readUInt32LE(cursor + 24);
        const nameLength = central.readUInt16LE(cursor + 28);
        const extraLength = central.readUInt16LE(cursor + 30);
        const commentLength = central.readUInt16LE(cursor + 32);
        const localHeaderOffset = central.readUInt32LE(cursor + 42);
        const recordLength = 46 + nameLength + extraLength + commentLength;
        if (cursor + recordLength > central.length) {
          throw new ImportValidationError("Truncated ZIP directory entry");
        }
        if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
          throw new ImportValidationError("ZIP64 entries are not supported");
        }
        if ((flags & 0x1) !== 0) throw new ImportValidationError("Encrypted ZIP entries are not supported");
        if (compressionMethod !== 0 && compressionMethod !== 8) {
          throw new ImportValidationError("Unsupported ZIP compression method");
        }

        const rawNameBytes = central.subarray(cursor + 46, cursor + 46 + nameLength);
        if ((flags & 0x800) === 0 && rawNameBytes.some((byte) => byte > 0x7f)) {
          throw new ImportValidationError("Non-ASCII ZIP entry names must use UTF-8");
        }
        const rawName = rawNameBytes.toString("utf8");
        if (!Buffer.from(rawName, "utf8").equals(rawNameBytes)) {
          throw new ImportValidationError("ZIP entry name is not valid UTF-8");
        }
        assertSafeArchivePath(rawName);
        const name = normalizeArchivePath(rawName);
        if (entries.has(name)) throw new ImportValidationError(`Duplicate ZIP entry: ${name}`);
        const directory = rawName.endsWith("/");
        if (!directory) {
          if (uncompressedSize > limits.maxEntryBytes) {
            throw new ImportValidationError(`Archive entry is too large: ${name}`, 413);
          }
          declaredExtractedBytes += uncompressedSize;
          if (declaredExtractedBytes > limits.maxExtractedBytes) {
            throw new ImportValidationError("Backup contents exceed maximum import size", 413);
          }
        }
        entries.set(name, {
          name,
          compressedSize,
          uncompressedSize,
          compressionMethod,
          flags,
          crc32,
          localHeaderOffset,
          directory,
        });
        cursor += recordLength;
      }
      if (cursor !== central.length) throw new ImportValidationError("Invalid ZIP directory size");
      return new StreamingZipArchive(filePath, stat.size, entries, centralOffset);
    } finally {
      await handle.close();
    }
  }

  get(name: string): StreamingZipEntry | undefined {
    const normalized = normalizeArchivePath(name);
    assertSafeArchivePath(normalized);
    return this.entries.get(normalized);
  }

  async stream(entry: StreamingZipEntry, budget: ExtractionBudget): Promise<Readable> {
    if (entry.directory) throw new ImportValidationError(`Cannot extract directory entry: ${entry.name}`);
    const handle = await fs.open(this.filePath, "r");
    let local: Buffer;
    try {
      local = await readExact(handle, 30, entry.localHeaderOffset);
      if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) {
        throw new ImportValidationError(`Invalid local ZIP header: ${entry.name}`);
      }
      const localFlags = local.readUInt16LE(6);
      const localMethod = local.readUInt16LE(8);
      const nameLength = local.readUInt16LE(26);
      const extraLength = local.readUInt16LE(28);
      const rawName = await readExact(handle, nameLength, entry.localHeaderOffset + 30);
      const localName = rawName.toString("utf8");
      assertSafeArchivePath(localName);
      if (normalizeArchivePath(localName) !== entry.name) {
        throw new ImportValidationError(`ZIP entry name mismatch: ${entry.name}`);
      }
      if (localFlags !== entry.flags || localMethod !== entry.compressionMethod) {
        throw new ImportValidationError(`ZIP entry metadata mismatch: ${entry.name}`);
      }
      const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
      if (dataOffset + entry.compressedSize > this.centralDirectoryOffset) {
        throw new ImportValidationError(`Invalid ZIP entry bounds: ${entry.name}`);
      }

      const compressed = entry.compressedSize === 0
        ? Readable.from([])
        : createReadStream(this.filePath, {
            start: dataOffset,
            end: dataOffset + entry.compressedSize - 1,
          });
      const source = entry.compressionMethod === 8
        ? compressed.pipe(createInflateRaw())
        : compressed;
      let bytes = 0;
      let crc = 0xffffffff;
      const verify = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          budget.extractedBytes += chunk.length;
          if (bytes > entry.uncompressedSize || budget.extractedBytes > budget.maxExtractedBytes) {
            callback(new ImportValidationError("Backup contents exceed maximum import size", 413));
            return;
          }
          crc = updateCrc32(crc, chunk);
          callback(null, chunk);
        },
        flush(callback) {
          const actualCrc = (crc ^ 0xffffffff) >>> 0;
          if (bytes !== entry.uncompressedSize) {
            callback(new ImportValidationError(`ZIP entry size mismatch: ${entry.name}`));
            return;
          }
          if (actualCrc !== entry.crc32) {
            callback(new ImportValidationError(`ZIP entry checksum mismatch: ${entry.name}`));
            return;
          }
          callback();
        },
      });
      return source.pipe(verify);
    } finally {
      await handle.close();
    }
  }

  async readBuffer(
    entry: StreamingZipEntry,
    maxBytes: number,
    budget: ExtractionBudget,
  ): Promise<Buffer> {
    if (entry.uncompressedSize > maxBytes) {
      throw new ImportValidationError(`Archive entry is too large: ${entry.name}`, 413);
    }
    const chunks: Buffer[] = [];
    const collector = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    await pipeline(await this.stream(entry, budget), collector);
    return Buffer.concat(chunks, entry.uncompressedSize);
  }
}
