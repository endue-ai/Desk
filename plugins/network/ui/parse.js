// What macOS's own programs print, as values: the ARP table (`arp -an`), the default route (`route
// -n get default`), an interface (`ifconfig en0`), one ping (`ping -c 1`) and an mDNS name
// (`dig -x <IP> -p 5353 @224.0.0.251 +short`). Every reader takes the program's text and never
// throws: what it cannot read is left out.
import { isPrivate, parseIp, prefixOfMask } from "./ipv4.js";

/**
 * @typedef {{ ip: string, mac: string, iface: string, permanent: boolean }} ArpEntry
 * @typedef {{ gateway: string, iface: string }} DefaultRoute
 * @typedef {{ ip: string, prefix: number, mac: string | null, active: boolean }} Interface
 */

/**
 * "1c:1b:d:df:18:d" (arp leaves out leading zeros) → "1c:1b:0d:df:18:0d"; null when it is not six
 * octets.
 * @param {unknown} text
 */
export function normalizeMac(text) {
  if (typeof text !== "string") return null;
  const parts = text.trim().toLowerCase().split(/[:-]/);
  if (parts.length !== 6 || parts.some((p) => !/^[0-9a-f]{1,2}$/.test(p))) return null;
  return parts.map((p) => p.padStart(2, "0")).join(":");
}

/** Broadcast, multicast and all-zero hardware addresses name no device. @param {string} mac */
export function isDeviceMac(mac) {
  if (mac === "ff:ff:ff:ff:ff:ff" || mac === "00:00:00:00:00:00") return false;
  const first = Number.parseInt(mac.slice(0, 2), 16);
  return (first & 1) === 0;
}

const ARP_LINE = /^\S+ \((\d+\.\d+\.\d+\.\d+)\) at (\S+) on (\S+)(.*)$/;

/**
 * The ARP table: one entry per answered IPv4 address with a device's MAC address. Incomplete
 * entries, broadcast and multicast addresses, and addresses outside the private ranges are left out.
 * @param {string} text
 * @returns {ArpEntry[]}
 */
export function parseArp(text) {
  /** @type {Map<string, ArpEntry>} */
  const byIp = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = ARP_LINE.exec(line.trim());
    if (!m) continue;
    const [, ip, at, iface, rest] = m;
    const mac = normalizeMac(at);
    const n = parseIp(ip);
    if (!mac || !isDeviceMac(mac) || n === null || !isPrivate(n)) continue;
    const last = n & 255;
    if (last === 255 || last === 0) continue;
    byIp.set(`${iface} ${ip}`, { ip, mac, iface, permanent: /\bpermanent\b/.test(rest) });
  }
  return [...byIp.values()];
}

/**
 * `route -n get default`: the gateway and the interface the default route leaves by; null when
 * there is none ("not in table") or the gateway is not an IPv4 address.
 * @param {string} text
 * @returns {DefaultRoute | null}
 */
export function parseRoute(text) {
  const gateway = /^\s*gateway:\s*(\S+)/m.exec(text)?.[1];
  const iface = /^\s*interface:\s*(\S+)/m.exec(text)?.[1];
  if (!gateway || !iface || parseIp(gateway) === null) return null;
  return { gateway, iface };
}

/**
 * `ifconfig <interface>`: its first IPv4 address with the prefix of its netmask, its MAC address,
 * and whether it is up; null without an IPv4 address.
 * @param {string} text
 * @returns {Interface | null}
 */
export function parseIfconfig(text) {
  const inet = /^\s*inet (\d+\.\d+\.\d+\.\d+) netmask (0x[0-9a-f]{8}|\d+\.\d+\.\d+\.\d+)/im.exec(
    text,
  );
  if (!inet) return null;
  const prefix = prefixOfMask(inet[2]);
  if (prefix === null) return null;
  const mac = normalizeMac(/^\s*ether (\S+)/m.exec(text)?.[1]);
  const status = /^\s*status: (\S+)/m.exec(text)?.[1];
  return { ip: inet[1], prefix, mac, active: status === undefined || status === "active" };
}

/**
 * One ping's round trip in milliseconds: the first reply's time, else the summary's average; null
 * when nothing answered.
 * @param {string} text
 */
export function parsePing(text) {
  const reply = /time[=<]([\d.]+) ?ms/.exec(text);
  if (reply) return Number(reply[1]);
  const summary = /= [\d.]+\/([\d.]+)\/[\d.]+/.exec(text);
  return summary ? Number(summary[1]) : null;
}

/**
 * The mDNS name dig heard for an address ("Studio-iMac.local." → "Studio-iMac"); null for no answer
 * or a line dig wrote about itself.
 * @param {string} text
 */
export function parseMdnsName(text) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";")) continue;
    const name = line.replace(/\.$/, "").replace(/\.local$/i, "");
    if (/^[\w][\w .'-]{0,62}$/u.test(name)) return name;
  }
  return null;
}

/** "Studio-iMac" → "Studio iMac", for a name a person reads. @param {string} name */
export function readableName(name) {
  return name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}
