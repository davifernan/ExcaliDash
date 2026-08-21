import { describe, expect, it } from "vitest";
import { resolveSocketClientAddress } from "./socketClientAddress";

const handshake = (address: string, forwarded?: string) => ({
  address,
  headers: forwarded === undefined ? {} : { "x-forwarded-for": forwarded },
});

describe("working out where a socket came from", () => {
  it("ignores the forwarded header when nothing is trusted", () => {
    // Otherwise a client names its own address and sheds every limit by
    // inventing a new one.
    expect(resolveSocketClientAddress(handshake("10.0.0.5", "1.2.3.4"), false)).toBe("10.0.0.5");
  });

  it("takes the original client when every proxy is trusted", () => {
    expect(resolveSocketClientAddress(handshake("10.0.0.5", "1.2.3.4, 10.0.0.1"), true)).toBe(
      "1.2.3.4",
    );
  });

  it("counts hops outwards from the connection, the way Express does", () => {
    // One proxy in front is the ordinary case, and the header holds only the
    // client: the first hop out is the client itself.
    expect(resolveSocketClientAddress(handshake("10.0.0.5", "1.2.3.4"), 1)).toBe("1.2.3.4");

    // With a longer chain, trusting one hop reaches only the nearest proxy --
    // which is the point: we trust what we put there, not what a client claims.
    const chain = handshake("10.0.0.5", "1.2.3.4, 9.9.9.9, 10.0.0.1");
    expect(resolveSocketClientAddress(chain, 1)).toBe("10.0.0.1");
    expect(resolveSocketClientAddress(chain, 2)).toBe("9.9.9.9");
    expect(resolveSocketClientAddress(chain, 3)).toBe("1.2.3.4");
  });

  it("falls back to the connection when the header says nothing", () => {
    expect(resolveSocketClientAddress(handshake("10.0.0.5"), true)).toBe("10.0.0.5");
    expect(resolveSocketClientAddress(handshake("10.0.0.5", "  "), true)).toBe("10.0.0.5");
  });

  it("does not run off the end of a short chain", () => {
    expect(resolveSocketClientAddress(handshake("10.0.0.5", "1.2.3.4"), 5)).toBe("1.2.3.4");
    expect(resolveSocketClientAddress(handshake("10.0.0.5"), 5)).toBe("10.0.0.5");
  });
});
