/**
 * The address a socket really came from.
 *
 * `socket.handshake.address` is whoever opened the TCP connection. Behind a
 * reverse proxy -- which is the documented deployment, and the one in the
 * project's own compose file -- that is the proxy, the same value for everyone.
 * Any budget keyed on it then belongs to all anonymous visitors at once: one
 * noisy guest, or one attacker, spends everybody's allowance.
 *
 * The HTTP side already solves this: Express is told how many proxies to trust
 * and works `req.ip` out from `X-Forwarded-For`. Sockets never got the same
 * treatment, so this applies the same setting to the same header.
 *
 * The setting matters more than the header. Trusting `X-Forwarded-For` when
 * nothing is in front of the server would let a client name its own address and
 * shed every limit by inventing a new one -- so with trust disabled, which is
 * the default, the header is ignored entirely.
 */
export type TrustProxySetting = boolean | number;

const forwardedChain = (header: unknown): string[] => {
  const raw = Array.isArray(header) ? header.join(",") : typeof header === "string" ? header : "";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export const resolveSocketClientAddress = (
  handshake: { address?: string; headers?: Record<string, unknown> },
  trustProxy: TrustProxySetting,
): string => {
  const direct = handshake.address || "";
  if (trustProxy === false || trustProxy === 0) return direct;

  const chain = forwardedChain(handshake.headers?.["x-forwarded-for"]);
  if (chain.length === 0) return direct;

  if (trustProxy === true) return chain[0] || direct;

  // Matching Express, which counts the connection itself as the first hop and
  // then walks outwards through the header from the nearest proxy to the
  // furthest. Trusting n hops means taking the (n+1)th of those.
  const hops = Math.max(1, Math.floor(trustProxy));
  const outwards = [direct, ...[...chain].reverse()];
  return outwards[Math.min(hops, outwards.length - 1)] || direct;
};
