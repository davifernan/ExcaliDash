import { BlockList, isIP } from "node:net";

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
