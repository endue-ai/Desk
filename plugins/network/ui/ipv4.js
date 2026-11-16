// IPv4 addresses as numbers and networks as an address and a prefix, and the one rule every probe
// keeps (NET-02): only the private network (RFC 1918) this computer is on now. A public address, an
// address of another range, a link-local or a multicast address is refused here, in code, before
// any program or socket is asked.

/** @typedef {{ base: number, prefix: number }} Network */

/** The private ranges of RFC 1918, as [base, prefix]. */
export const PRIVATE_RANGES = Object.freeze([
  [0x0a000000, 8],
  [0xac100000, 12],
  [0xc0a80000, 16],
]);

/** Above this many addresses (a prefix below /24) the plugin reads the ARP table and sweeps nothing. */
export const SWEEP_PREFIX = 24;

/** "192.168.0.10" → a 32-bit number; null for anything else. @param {unknown} text */
export function parseIp(text) {
  if (typeof text !== "string") return null;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text.trim());
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** @param {number} n */
export function ipText(n) {
  return [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join(".");
}

/** @param {number} prefix */
const maskOf = (prefix) => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);

/**
 * A netmask as ifconfig prints it ("0xffffff00") or dotted ("255.255.255.0") → its prefix length;
 * null when it is not a contiguous mask.
 * @param {string} mask
 */
export function prefixOfMask(mask) {
  const value = /^0x[0-9a-f]{8}$/i.test(mask) ? Number.parseInt(mask, 16) >>> 0 : parseIp(mask);
  if (value === null) return null;
  for (let prefix = 0; prefix <= 32; prefix++) if (maskOf(prefix) === value) return prefix;
  return null;
}

/** The network `ip` is in, with `prefix`. @param {number} ip @param {number} prefix @returns {Network} */
export function networkOf(ip, prefix) {
  return { base: (ip & maskOf(prefix)) >>> 0, prefix };
}

/** "192.168.0.0/24". @param {Network} net */
export function cidrText(net) {
  return `${ipText(net.base)}/${net.prefix}`;
}

/** @param {number} ip @param {Network} net */
export function inNetwork(ip, net) {
  return (ip & maskOf(net.prefix)) >>> 0 === net.base;
}

/** Whether the address is in one of RFC 1918's private ranges. @param {number} ip */
export function isPrivate(ip) {
  return PRIVATE_RANGES.some(([base, prefix]) => inNetwork(ip, { base, prefix }));
}

/**
 * Whether the plugin may look at this network at all: private, and no wider than one private range.
 * @param {Network} net
 * @returns {null | "public" | "too-wide"}
 */
export function networkRefusal(net) {
  if (!isPrivate(net.base)) return "public";
  const range = PRIVATE_RANGES.find(([base, prefix]) => inNetwork(net.base, { base, prefix }));
  if (range && net.prefix < range[1]) return "too-wide";
  return null;
}

/**
 * Why `ip` may not be probed on `net`, or null when it may: a probe goes only to a private address of
 * the network this computer is on, never its network or broadcast address.
 * @param {unknown} ip @param {Network | null} net
 * @returns {null | "invalid" | "public" | "other-range" | "no-network"}
 */
export function targetRefusal(ip, net) {
  const n = typeof ip === "number" ? ip : parseIp(ip);
  if (n === null) return "invalid";
  if (!isPrivate(n)) return "public";
  if (!net) return "no-network";
  if (!inNetwork(n, net)) return "other-range";
  const broadcast = (net.base | (~maskOf(net.prefix) >>> 0)) >>> 0;
  if (net.prefix < 31 && (n === net.base || n === broadcast)) return "other-range";
  return null;
}

/**
 * The addresses a sweep pings: every host of a /24 or smaller network but this computer's own; null
 * for a wider network, which only the ARP table shows (NET-03).
 * @param {Network} net @param {number} [self]
 */
export function sweepHosts(net, self) {
  if (net.prefix < SWEEP_PREFIX || networkRefusal(net)) return null;
  const size = 2 ** (32 - net.prefix);
  const hosts = [];
  for (let i = 1; i < size - 1; i++) {
    const ip = (net.base + i) >>> 0;
    if (ip !== self) hosts.push(ip);
  }
  return hosts;
}

/** Sort key for addresses written as text. @param {string} a @param {string} b */
export function compareIp(a, b) {
  return (parseIp(a) ?? 0) - (parseIp(b) ?? 0);
}
