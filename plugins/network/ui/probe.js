// One look at the network this computer is on (NET-01–NET-03): the default route and its
// interface, then the ARP table; on a network of /24 or smaller whose administrator said yes, a
// ping to every address first so the table fills, then each device's mDNS name. A network wider
// than /24 is never swept: its ARP table is all there is. Every address is checked by ipv4.js before
// a program is pointed at it.
import {
  cidrText,
  ipText,
  networkOf,
  networkRefusal,
  parseIp,
  sweepHosts,
  targetRefusal,
} from "./ipv4.js";
import { parseArp, parseIfconfig, parseMdnsName, parsePing, parseRoute } from "./parse.js";
import { NetworkRefusal } from "./refusal.js";
import { parseWifi } from "./wifi.js";

/**
 * @typedef {import("./run.js").Runner} Runner
 * @typedef {import("./ipv4.js").Network} Network
 * @typedef {{ iface: string, network: Network, cidr: string, self: { ip: string, mac: string | null },
 *   gateway: { ip: string, mac: string | null }, id: string }} Here
 * @typedef {import("./devices.js").Scan & { here: Here, swept: boolean, wide: boolean }} NetworkScan
 */

/** Pings and dig queries in flight at once. */
export const PARALLEL = 16;

/** Where the computer is: its default route, its interface's address and the network around it. @param {Runner} runner */
export async function locate(runner) {
  const route = parseRoute(
    (await runner.run("route", ["-n", "get", "default"], { timeoutMs: 5000 })).stdout,
  );
  if (!route) throw new NetworkRefusal("no-network");
  if (!/^[a-z]+\d+$/.test(route.iface)) throw new NetworkRefusal("no-network");
  const iface = parseIfconfig(
    (await runner.run("ifconfig", [route.iface], { timeoutMs: 5000 })).stdout,
  );
  const ip = iface ? parseIp(iface.ip) : null;
  if (!iface || ip === null) throw new NetworkRefusal("no-network");
  const network = networkOf(ip, iface.prefix);
  const why = networkRefusal(network);
  if (why === "public") throw new NetworkRefusal("public", { ip: iface.ip });
  if (why === "too-wide") throw new NetworkRefusal("other-range", { ip: cidrText(network) });
  if (targetRefusal(route.gateway, network))
    throw new NetworkRefusal("other-range", { ip: route.gateway });
  return { route, iface, network };
}

/** The ARP table's entries on one interface. @param {Runner} runner @param {string} iface */
export async function readArp(runner, iface) {
  const { stdout } = await runner.run("arp", ["-an"], { timeoutMs: 5000 });
  return parseArp(stdout).filter((e) => e.iface === iface);
}

/** One ping's round trip in ms, or null. @param {Runner} runner @param {string} ip @param {Network} network */
export async function pingOnce(runner, ip, network) {
  const why = targetRefusal(ip, network);
  if (why) throw new NetworkRefusal(why, { ip });
  const { stdout } = await runner.run("ping", ["-n", "-q", "-c", "1", "-W", "800", "-t", "2", ip], {
    timeoutMs: 4000,
  });
  return parsePing(stdout);
}

/** The mDNS name the device answers to, or null. @param {Runner} runner @param {string} ip @param {Network} network */
export async function mdnsName(runner, ip, network) {
  const why = targetRefusal(ip, network);
  if (why) throw new NetworkRefusal(why, { ip });
  const args = ["-x", ip, "-p", "5353", "@224.0.0.251", "+short", "+time=1", "+tries=1"];
  const { stdout } = await runner.run("dig", args, { timeoutMs: 4000 });
  return parseMdnsName(stdout);
}

/**
 * Run `task` over `items`, PARALLEL at a time, reporting progress.
 * @template T, R
 * @param {T[]} items @param {(item: T) => Promise<R>} task @param {(done: number) => void} [onDone]
 * @returns {Promise<R[]>}
 */
export async function pool(items, task, onDone, parallel = PARALLEL) {
  /** @type {R[]} */
  const out = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await task(items[i]);
      onDone?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, worker));
  return out;
}

/**
 * Look at the network.
 * @param {Runner} runner
 * @param {{ admin(id: string, cidr: string): Promise<boolean>, now?: () => string,
 *   onProgress?(phase: "sweep" | "names" | "ping", done: number, total: number): void }} options
 *   `admin` answers whether the person administers the network; false: only the ARP table and one
 *   ping to the router, nothing swept, no names asked.
 * @returns {Promise<NetworkScan>}
 */
export async function scanNetwork(runner, options) {
  const { route, iface, network } = await locate(runner);
  const progress = options.onProgress ?? (() => {});
  const selfIp = /** @type {number} */ (parseIp(iface.ip));
  const inside = (/** @type {import("./parse.js").ArpEntry[]} */ entries) =>
    entries.filter((e) => !targetRefusal(e.ip, network));
  let arp = inside(await readArp(runner, route.iface));
  const gatewayMac = arp.find((e) => e.ip === route.gateway)?.mac ?? null;
  const id = networkId(route.gateway, gatewayMac);
  const admin = await options.admin(id, cidrText(network));
  const hosts = admin ? sweepHosts(network, selfIp) : null;
  /** @type {Map<string, number | null>} */
  const pings = new Map();
  if (hosts) {
    const ips = hosts.map(ipText);
    const times = await pool(
      ips,
      (ip) => pingOnce(runner, ip, network),
      (n) => progress("sweep", n, ips.length),
    );
    ips.forEach((ip, i) => {
      if (times[i] !== null) pings.set(ip, times[i]);
    });
    arp = inside(await readArp(runner, route.iface));
  } else {
    // No sweep: the router always, and the devices of the table too when the person runs the network.
    const targets = admin
      ? arp.map((e) => e.ip)
      : arp.some((e) => e.ip === route.gateway)
        ? [route.gateway]
        : [];
    const times = await pool(
      targets,
      (ip) => pingOnce(runner, ip, network),
      (n) => progress("ping", n, targets.length),
    );
    targets.forEach((ip, i) => {
      pings.set(ip, times[i]);
    });
  }
  const others = arp.filter((e) => e.ip !== iface.ip);
  const names = admin
    ? await pool(
        others,
        (e) => mdnsName(runner, e.ip, network),
        (n) => progress("names", n, others.length),
      )
    : others.map(() => null);
  const seen = others.map((e, i) => ({
    ip: e.ip,
    mac: e.mac,
    ping: pings.get(e.ip) ?? null,
    mdns: names[i],
  }));
  if (iface.mac) seen.push({ ip: iface.ip, mac: iface.mac, ping: null, mdns: null });
  const gateway = { ip: route.gateway, mac: gatewayMac };
  const self = { ip: iface.ip, mac: iface.mac };
  return {
    at: (options.now ?? (() => new Date().toISOString()))(),
    here: { iface: route.iface, network, cidr: cidrText(network), self, gateway, id },
    gateway,
    self,
    seen,
    swept: hosts !== null,
    wide: network.prefix < 24,
  };
}

/** A network's key in the store: its router's MAC address, else its address. @param {string} ip @param {string | null} mac */
export function networkId(ip, mac) {
  return mac ? `gw-${mac.replace(/:/g, "")}` : `ip-${ip.replace(/\./g, "-")}`;
}

/** The Wi-Fi report, or a refusal when the computer has none. @param {Runner} runner */
export async function readWifi(runner) {
  const { stdout } = await runner.run("profiler", ["SPAirPortDataType", "-json"], {
    timeoutMs: 40_000,
  });
  const report = parseWifi(stdout);
  if (!report) throw new NetworkRefusal("wifi-missing");
  return report;
}
