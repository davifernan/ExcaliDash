import { lookup as dnsLookup } from "node:dns/promises";
import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

export type PreviewFetchKind = "html" | "image";

export type PreviewNetworkLimits = {
  dnsTimeoutMs: number;
  connectTimeoutMs: number;
  totalTimeoutMs: number;
  maxRedirects: number;
  maxWireBytes: number;
  maxDecodedBytes: number;
};

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type PreviewFetchResult = {
  body: Buffer;
  contentType: string;
  finalUrl: URL;
  headers: IncomingHttpHeaders;
};

export class PreviewFetchError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PreviewFetchError";
  }
}

type NetworkDeps = {
  resolve?: (
    hostname: string,
    timeoutMs: number,
    signal: AbortSignal,
  ) => Promise<ResolvedAddress[]>;
  request?: (
    url: URL,
    address: ResolvedAddress,
    connectTimeoutMs: number,
    signal: AbortSignal,
  ) => Promise<IncomingMessage>;
};

const blockedV6 = new BlockList();
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blockedV6.addSubnet("::", 8, "ipv6");
blockedV6.addSubnet("fc00::", 7, "ipv6");
blockedV6.addSubnet("fe80::", 10, "ipv6");
blockedV6.addSubnet("ff00::", 8, "ipv6");
blockedV6.addSubnet("2001::", 32, "ipv6");
blockedV6.addSubnet("2001:2::", 48, "ipv6");
blockedV6.addSubnet("2001:10::", 28, "ipv6");
blockedV6.addSubnet("2001:db8::", 32, "ipv6");
blockedV6.addSubnet("2002::", 16, "ipv6");
blockedV6.addSubnet("2620:4f:8000::", 48, "ipv6");

const inV4Range = (value: number, base: number, prefix: number): boolean => {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
};

const ipv4Number = (address: string): number | null => {
  const octets = address.split(".");
  if (octets.length !== 4) return null;
  const numbers = octets.map(Number);
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return numbers.reduce((value, part) => ((value << 8) | part) >>> 0, 0);
};

const blockedV4Ranges: Array<[number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

/** Only globally routable addresses may become a socket destination. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    return (
      value !== null && !blockedV4Ranges.some(([base, prefix]) => inV4Range(value, base, prefix))
    );
  }
  if (family !== 6) return false;
  if (blockedV6.check(address, "ipv6")) return false;
  // Global unicast is 2000::/3. Refusing transition/special ranges is safer
  // than trying to discover what an operating system might route internally.
  return globalV6.check(address, "ipv6");
}

const timeoutError = (part: string) =>
  new PreviewFetchError("TIMEOUT", `The remote ${part} did not finish in time.`);

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  part: string,
  signal?: AbortSignal,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(timeoutError(part)), timeoutMs);
      }),
      new Promise<T>((_resolve, reject) => {
        abort = () => reject(timeoutError("request"));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

export async function resolvePublicAddresses(
  rawHostname: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ResolvedAddress[]> {
  const hostname = rawHostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  const found = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : ((await withTimeout(
        dnsLookup(hostname, { all: true, verbatim: true }),
        timeoutMs,
        "name lookup",
        signal,
      )) as ResolvedAddress[]);
  if (signal.aborted) throw timeoutError("request");
  if (found.length === 0) throw new PreviewFetchError("DNS_EMPTY", "The host has no address.");
  if (found.some(({ address }) => !isPublicAddress(address))) {
    throw new PreviewFetchError("SSRF_BLOCKED", "The address points to a non-public network.");
  }
  return found;
}

function openPinnedRequest(
  url: URL,
  target: ResolvedAddress,
  connectTimeoutMs: number,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request({
      protocol: url.protocol,
      hostname: target.address,
      family: target.family,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      agent: false,
      signal,
      servername: url.hostname.replace(/^\[|\]$/g, ""),
      headers: {
        Host: url.host,
        Accept: "text/html, image/avif, image/webp, image/png, image/jpeg;q=0.9, */*;q=0.1",
        "Accept-Encoding": "br, gzip, deflate",
        "User-Agent": "ExcaliDash-LinkPreview/1.0",
      },
    });
    const connectTimer = setTimeout(
      () => request.destroy(timeoutError("connection")),
      connectTimeoutMs,
    );
    request.once("socket", (socket) => {
      const connected = () => clearTimeout(connectTimer);
      socket.once(url.protocol === "https:" ? "secureConnect" : "connect", connected);
    });
    request.once("response", (response) => {
      clearTimeout(connectTimer);
      resolve(response);
    });
    request.once("error", (error) => {
      clearTimeout(connectTimer);
      reject(error);
    });
    request.end();
  });
}

function checkedUrl(raw: string | URL, previous?: URL): URL {
  let url: URL;
  try {
    url = raw instanceof URL ? new URL(raw.href) : new URL(raw);
  } catch {
    throw new PreviewFetchError("INVALID_URL", "A valid absolute URL is required.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PreviewFetchError("INVALID_URL", "Only HTTP and HTTPS URLs are supported.");
  }
  if (url.username || url.password) {
    throw new PreviewFetchError("INVALID_URL", "URLs containing credentials are not supported.");
  }
  if (previous?.protocol === "https:" && url.protocol !== "https:") {
    throw new PreviewFetchError("HTTPS_DOWNGRADE", "HTTPS redirects may not downgrade to HTTP.");
  }
  url.hash = "";
  return url;
}

function contentTypeOf(headers: IncomingHttpHeaders): string {
  return String(headers["content-type"] ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function decodedStream(response: IncomingMessage): Readable {
  const encoding = String(response.headers["content-encoding"] ?? "identity")
    .toLowerCase()
    .trim();
  if (!encoding || encoding === "identity") return response;
  if (encoding === "gzip" || encoding === "x-gzip") return response.pipe(createGunzip());
  if (encoding === "deflate") return response.pipe(createInflate());
  if (encoding === "br") return response.pipe(createBrotliDecompress());
  throw new PreviewFetchError("UNSUPPORTED_ENCODING", "The response uses an unsupported encoding.");
}

async function readBounded(
  response: IncomingMessage,
  limits: PreviewNetworkLimits,
  stopAfterHead: boolean,
): Promise<Buffer> {
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limits.maxWireBytes) {
    response.destroy();
    throw new PreviewFetchError("TOO_LARGE", "The response is larger than the allowed limit.");
  }
  let wireBytes = 0;
  response.on("data", (chunk: Buffer) => {
    wireBytes += chunk.length;
    if (wireBytes > limits.maxWireBytes) response.destroy();
  });
  let stream: Readable;
  try {
    stream = decodedStream(response);
  } catch (error) {
    response.destroy();
    throw error;
  }
  const chunks: Buffer[] = [];
  let decodedBytes = 0;
  try {
    for await (const value of stream) {
      if (wireBytes > limits.maxWireBytes) {
        throw new PreviewFetchError("TOO_LARGE", "The compressed response exceeded its limit.");
      }
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      decodedBytes += chunk.length;
      if (decodedBytes > limits.maxDecodedBytes) {
        throw new PreviewFetchError("TOO_LARGE", "The decoded response exceeded its limit.");
      }
      chunks.push(chunk);
      if (stopAfterHead) {
        const body = Buffer.concat(chunks);
        const lower = body.toString("latin1").toLowerCase();
        const headEnd = lower.indexOf("</head");
        const bodyStart = lower.search(/<(?:body|frameset)\b/);
        if (headEnd >= 0 || bodyStart >= 0) {
          if (bodyStart >= 0 && (headEnd < 0 || bodyStart < headEnd)) {
            return body.subarray(0, bodyStart);
          }
          const close = body.indexOf(0x3e, headEnd);
          return close >= 0 ? body.subarray(0, close + 1) : body;
        }
      }
    }
  } catch (error) {
    if (wireBytes > limits.maxWireBytes) {
      throw new PreviewFetchError("TOO_LARGE", "The compressed response exceeded its limit.");
    }
    throw error;
  } finally {
    response.destroy();
    if (stream !== response) stream.destroy();
  }
  return Buffer.concat(chunks);
}

export async function fetchPreviewResource(
  rawUrl: string | URL,
  kind: PreviewFetchKind,
  limits: PreviewNetworkLimits,
  deps: NetworkDeps = {},
  outerSignal?: AbortSignal,
): Promise<PreviewFetchResult> {
  const controller = new AbortController();
  const totalTimer = setTimeout(
    () => controller.abort(timeoutError("request")),
    limits.totalTimeoutMs,
  );
  const abort = () => controller.abort(outerSignal?.reason);
  outerSignal?.addEventListener("abort", abort, { once: true });
  let current = checkedUrl(rawUrl);
  try {
    for (let redirects = 0; ; redirects += 1) {
      const resolve = deps.resolve ?? resolvePublicAddresses;
      const addresses = await resolve(current.hostname, limits.dnsTimeoutMs, controller.signal);
      const request = deps.request ?? openPinnedRequest;
      const response = await request(
        current,
        addresses[0],
        limits.connectTimeoutMs,
        controller.signal,
      );
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.destroy();
        if (redirects >= limits.maxRedirects) {
          throw new PreviewFetchError("TOO_MANY_REDIRECTS", "The URL redirected too many times.");
        }
        const location = response.headers.location;
        if (!location)
          throw new PreviewFetchError("BAD_REDIRECT", "The redirect has no destination.");
        current = checkedUrl(new URL(location, current), current);
        continue;
      }
      if (status < 200 || status >= 300) {
        response.destroy();
        throw new PreviewFetchError("HTTP_STATUS", `The remote server returned HTTP ${status}.`);
      }
      const contentType = contentTypeOf(response.headers);
      if (kind === "html" ? contentType !== "text/html" : !contentType.startsWith("image/")) {
        response.destroy();
        throw new PreviewFetchError(
          "UNSUPPORTED_TYPE",
          "The response is not the expected content type.",
        );
      }
      const body = await readBounded(response, limits, kind === "html");
      return { body, contentType, finalUrl: current, headers: response.headers };
    }
  } catch (error) {
    if (error instanceof PreviewFetchError) throw error;
    if (controller.signal.aborted) throw timeoutError("request");
    throw new PreviewFetchError("NETWORK_ERROR", "The remote server could not be reached.");
  } finally {
    clearTimeout(totalTimer);
    outerSignal?.removeEventListener("abort", abort);
  }
}
