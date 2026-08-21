import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  fetchPreviewResource,
  isPublicAddress,
  PreviewFetchError,
  resolvePublicAddresses,
  type PreviewNetworkLimits,
} from "./network";

const limits: PreviewNetworkLimits = {
  dnsTimeoutMs: 100,
  connectTimeoutMs: 100,
  totalTimeoutMs: 1_000,
  maxRedirects: 3,
  maxWireBytes: 1_024,
  maxDecodedBytes: 1_024,
};

function response(
  statusCode: number,
  headers: Record<string, string>,
  chunks: Buffer[] = [],
): IncomingMessage {
  const stream = Readable.from(chunks) as IncomingMessage;
  stream.statusCode = statusCode;
  stream.headers = headers;
  return stream;
}

describe("SSRF address policy", () => {
  it.each([
    "127.0.0.1",
    "169.254.169.254",
    "10.2.3.4",
    "172.16.0.1",
    "192.168.50.10",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fc00::1234",
    "fd12:3456::1",
  ])("rejects local address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"])(
    "accepts public address %s",
    (address) => expect(isPublicAddress(address)).toBe(true),
  );

  it("rejects an IP literal before opening a request", async () => {
    await expect(
      resolvePublicAddresses("127.0.0.1", 100, new AbortController().signal),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });
});

describe("bounded pinned fetching", () => {
  it("resolves and checks the destination again after a redirect", async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockRejectedValueOnce(
        new PreviewFetchError("SSRF_BLOCKED", "The address points to a non-public network."),
      );
    const request = vi
      .fn()
      .mockResolvedValueOnce(response(302, { location: "http://internal.test/secret" }));

    await expect(
      fetchPreviewResource("http://public.test", "html", limits, { resolve, request }),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("refuses an HTTPS to HTTP redirect", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(response(302, { location: "http://public.test/plain" }));
    await expect(
      fetchPreviewResource("https://public.test", "html", limits, {
        resolve: async () => [{ address: "93.184.216.34", family: 4 }],
        request,
      }),
    ).rejects.toMatchObject({ code: "HTTPS_DOWNGRADE" });
  });

  it("aborts a response larger than the wire limit", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(response(200, { "content-type": "text/html" }, [Buffer.alloc(2_000, 65)]));
    await expect(
      fetchPreviewResource("http://public.test", "html", limits, {
        resolve: async () => [{ address: "93.184.216.34", family: 4 }],
        request,
      }),
    ).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("aborts a small compressed response that inflates past its limit", async () => {
    const compressed = gzipSync(Buffer.from("<head>" + "x".repeat(2_000) + "</head>"));
    const request = vi
      .fn()
      .mockResolvedValue(
        response(200, { "content-type": "text/html", "content-encoding": "gzip" }, [compressed]),
      );
    await expect(
      fetchPreviewResource("http://public.test", "html", limits, {
        resolve: async () => [{ address: "93.184.216.34", family: 4 }],
        request,
      }),
    ).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("stops after the closing head without reading a large body", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        response(200, { "content-type": "text/html" }, [
          Buffer.from("<html><head><title>Enough</title></head>"),
          Buffer.alloc(10_000, 65),
        ]),
      );
    const result = await fetchPreviewResource("http://public.test", "html", limits, {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request,
    });
    expect(result.body.toString()).toBe("<html><head><title>Enough</title></head>");
  });

  it("treats a body tag as the end of a malformed unclosed head", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        response(200, { "content-type": "text/html" }, [
          Buffer.from("<html><head><title>Enough</title><body>do not read"),
        ]),
      );
    const result = await fetchPreviewResource("http://public.test", "html", limits, {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request,
    });
    expect(result.body.toString()).toBe("<html><head><title>Enough</title>");
  });
});
