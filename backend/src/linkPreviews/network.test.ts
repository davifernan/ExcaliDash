import { createServer, type IncomingMessage } from "node:http";
import { connect as netConnect } from "node:net";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
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
  allowedPorts: [80, 443],
  dnsConcurrency: 2,
  dnsQueueSize: 4,
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

async function withHttpServer<T>(
  handler: Parameters<typeof createServer>[0],
  work: (port: number) => Promise<T>,
): Promise<T> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server has no TCP port");
  try {
    return await work(address.port);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
}

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 as const }];

const connectTestServer = (port: number) => (options: any) => {
  expect(options.host ?? options.hostname).toBe("93.184.216.34");
  return netConnect({ host: "127.0.0.1", port });
};

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
    const lookup = vi
      .fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const request = vi
      .fn()
      .mockResolvedValueOnce(response(302, { location: "http://internal.test/secret" }));

    await expect(
      fetchPreviewResource("http://public.test", "html", limits, { lookup, request }),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("refuses an HTTPS to HTTP redirect", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(response(302, { location: "http://public.test/plain" }));
    await expect(
      fetchPreviewResource("https://public.test", "html", limits, {
        lookup: publicLookup,
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
        lookup: publicLookup,
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
        lookup: publicLookup,
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
      lookup: publicLookup,
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
      lookup: publicLookup,
      request,
    });
    expect(result.body.toString()).toBe("<html><head><title>Enough</title>");
  });

  it("refuses a real loopback server before a socket reaches it", async () => {
    let requests = 0;
    await withHttpServer(
      (_request, response) => {
        requests += 1;
        response.end("<head><title>secret</title></head>");
      },
      async (port) => {
        await expect(
          fetchPreviewResource(`http://127.0.0.1:${port}/secret`, "html", {
            ...limits,
            allowedPorts: [port],
          }),
        ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
      },
    );
    expect(requests).toBe(0);
  });

  it("opens the real socket to the checked IP, not the original hostname", async () => {
    await withHttpServer(
      (_request, response) => {
        response.setHeader("Content-Type", "text/html");
        response.end("<head><title>Pinned</title></head>");
      },
      async (port) => {
        const result = await fetchPreviewResource(
          `http://public.test:${port}/page`,
          "html",
          { ...limits, allowedPorts: [port] },
          { lookup: publicLookup, connect: connectTestServer(port) },
        );
        expect(result.body.toString()).toContain("Pinned");
      },
    );
  });

  it("rejects mixed public and private DNS answers before the real request", async () => {
    let requests = 0;
    await withHttpServer(
      (_request, response) => {
        requests += 1;
        response.end("<head></head>");
      },
      async (port) => {
        await expect(
          fetchPreviewResource(
            `http://mixed.test:${port}`,
            "html",
            { ...limits, allowedPorts: [port] },
            {
              lookup: async () => [
                { address: "93.184.216.34", family: 4 },
                { address: "127.0.0.1", family: 4 },
              ],
              connect: connectTestServer(port),
            },
          ),
        ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
      },
    );
    expect(requests).toBe(0);
  });

  it.each(["2130706433", "0177.0.0.1", "0x7f000001", "[::ffff:127.0.0.1]"])(
    "normalizes and refuses alternate loopback spelling %s",
    async (host) => {
      await withHttpServer(
        (_request, response) => response.end("private"),
        async (port) => {
          await expect(
            fetchPreviewResource(`http://${host}:${port}`, "html", {
              ...limits,
              allowedPorts: [port],
            }),
          ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
        },
      );
    },
  );

  it("rejects credentials before contacting a real server", async () => {
    let requests = 0;
    await withHttpServer(
      (_request, response) => {
        requests += 1;
        response.end("private");
      },
      async (port) => {
        await expect(
          fetchPreviewResource(`http://user:pass@127.0.0.1:${port}`, "html", {
            ...limits,
            allowedPorts: [port],
          }),
        ).rejects.toMatchObject({ code: "INVALID_URL" });
      },
    );
    expect(requests).toBe(0);
  });

  it("checks a real redirect destination and never follows it to loopback", async () => {
    let requests = 0;
    await withHttpServer(
      (request, response) => {
        requests += 1;
        if (request.url === "/start") {
          response.writeHead(302, {
            location: `http://127.0.0.1:${(request.socket.address() as any).port}/secret`,
          });
          response.end();
        } else {
          response.end("secret");
        }
      },
      async (port) => {
        await expect(
          fetchPreviewResource(
            `http://public.test:${port}/start`,
            "html",
            { ...limits, allowedPorts: [port] },
            { lookup: publicLookup, connect: connectTestServer(port) },
          ),
        ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
      },
    );
    expect(requests).toBe(1);
  });

  it("enforces the redirect limit against a real redirect loop", async () => {
    let requests = 0;
    await withHttpServer(
      (_request, response) => {
        requests += 1;
        response.writeHead(302, { location: "/again" });
        response.end();
      },
      async (port) => {
        await expect(
          fetchPreviewResource(
            `http://public.test:${port}/start`,
            "html",
            { ...limits, allowedPorts: [port], maxRedirects: 1 },
            { lookup: publicLookup, connect: connectTestServer(port) },
          ),
        ).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
      },
    );
    expect(requests).toBe(2);
  });

  it("aborts a real response whose stream stalls", async () => {
    await withHttpServer(
      (_request, response) => {
        response.setHeader("Content-Type", "text/html");
        response.write("<head><title>never finished");
      },
      async (port) => {
        await expect(
          fetchPreviewResource(
            `http://public.test:${port}/slow`,
            "html",
            { ...limits, allowedPorts: [port], totalTimeoutMs: 40 },
            { lookup: publicLookup, connect: connectTestServer(port) },
          ),
        ).rejects.toMatchObject({ code: "TIMEOUT" });
      },
    );
  });

  it("refuses arbitrary public ports before DNS or connection", async () => {
    const lookup = vi.fn(publicLookup);
    await expect(
      fetchPreviewResource("http://public.test:22", "html", limits, { lookup }),
    ).rejects.toMatchObject({ code: "PORT_BLOCKED" });
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("DNS work admission", () => {
  it("keeps timed-out underlying lookups inside the concurrency ceiling", async () => {
    let active = 0;
    let maximum = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const lookup = vi.fn(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await gate;
      active -= 1;
      return [{ address: "93.184.216.34", family: 4 as const }];
    });

    const attempts = Array.from({ length: 6 }, (_, index) =>
      resolvePublicAddresses(`slow-${index}.test`, 20, new AbortController().signal, {
        lookup,
        concurrency: 2,
        maxWaiting: 8,
      }),
    );
    await Promise.allSettled(attempts);
    expect(maximum).toBe(2);
    expect(lookup).toHaveBeenCalledTimes(2);
    release();
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(6));
  });
});
