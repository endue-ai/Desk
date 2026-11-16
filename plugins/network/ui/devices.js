// The devices of one network (NET-04, NET-05, NET-07): what a scan saw merged into what the plugin
// kept, keyed by MAC address. A device the network has never shown is new; one that was gone and
// answers again is back; one that stays away past GONE_MS is gone. The very first scan of a network
// only takes stock: it tells nobody about the devices that were already there.

import { compareIp } from "./ipv4.js";
import { guessKind, isKind } from "./kinds.js";
import { isRandomMac, vendorOf } from "./oui.js";
import { portInfo } from "./ports.js";

/**
 * @typedef {import("./kinds.js").Kind} Kind
 * @typedef {{ ip: string, mac: string, ping: number | null, mdns: string | null }} Seen
 * @typedef {{ at: string, gateway: { ip: string, mac: string | null }, self: { ip: string, mac: string | null },
 *   seen: Seen[] }} Scan
 * @typedef {{ ip: string, first: string, last: string, name?: string, kind?: Kind, mine?: boolean,
 *   known?: boolean, mdns?: string, gone?: boolean, ping?: number | null }} DeviceRecord
 * @typedef {Record<string, DeviceRecord>} Records
 * @typedef {{ kind: "new" | "back" | "gone" | "first", at: string, mac?: string, ip?: string, count?: number }} DeviceEvent
 * @typedef {"fast" | "ok" | "slow" | "none"} Speed
 * @typedef {"known" | "new" | "caution"} Status
 * @typedef {{ mac: string, ip: string, name: string | null, mdns: string | null, vendor: string | null,
 *   randomMac: boolean, kind: Kind, kindGuessed: boolean, mine: boolean, known: boolean, gateway: boolean,
 *   self: boolean, online: boolean, ping: number | null, speed: Speed, first: string, last: string,
 *   status: Status, open: number[] | null, risky: number[] }} Device
 */

/** A device away this long, and absent from a scan, is gone. */
export const GONE_MS = 15 * 60 * 1000;
/** At most this many devices are kept per network; the longest unseen go first. */
export const MAX_RECORDS = 300;

/** fast below 20 ms, ok below 100 ms, slow above; none when nothing answered. @param {number | null} ms @returns {Speed} */
export function speedOf(ms) {
  if (ms === null || !Number.isFinite(ms)) return "none";
  if (ms < 20) return "fast";
  if (ms < 100) return "ok";
  return "slow";
}

/**
 * Merge a scan into the records.
 * @param {Records} records What was kept (not changed).
 * @param {Scan} scan
 * @returns {{ records: Records, events: DeviceEvent[] }}
 */
export function mergeScan(records, scan) {
  const first = Object.keys(records).length === 0;
  /** @type {Records} */
  const next = {};
  /** @type {DeviceEvent[]} */
  const events = [];
  const seen = new Set();
  const now = Date.parse(scan.at);
  for (const s of scan.seen) {
    if (seen.has(s.mac)) continue;
    seen.add(s.mac);
    const kept = records[s.mac];
    /** @type {DeviceRecord} */
    const record = {
      ...(kept ?? { first: scan.at }),
      ip: s.ip,
      last: scan.at,
      ping: s.ping,
      ...(s.mdns ? { mdns: s.mdns } : {}),
    };
    delete record.gone;
    if (!kept && !first) events.push({ kind: "new", at: scan.at, mac: s.mac, ip: s.ip });
    if (kept?.gone) events.push({ kind: "back", at: scan.at, mac: s.mac, ip: s.ip });
    next[s.mac] = record;
  }
  for (const [mac, kept] of Object.entries(records)) {
    if (seen.has(mac)) continue;
    const away = now - Date.parse(kept.last);
    if (!kept.gone && away >= GONE_MS) {
      events.push({ kind: "gone", at: scan.at, mac, ip: kept.ip });
      next[mac] = { ...kept, gone: true };
    } else next[mac] = kept;
  }
  if (first && scan.seen.length > 0) events.push({ kind: "first", at: scan.at, count: seen.size });
  return { records: trimRecords(next), events };
}

/** Keep at most MAX_RECORDS, the most recently seen. @param {Records} records */
export function trimRecords(records, max = MAX_RECORDS) {
  const entries = Object.entries(records);
  if (entries.length <= max) return records;
  entries.sort(([, a], [, b]) => b.last.localeCompare(a.last));
  return Object.fromEntries(entries.slice(0, max));
}

/**
 * Every device a person or an agent reads: the records, with what the plugin knows besides.
 * @param {Records} records
 * @param {{ oui: import("./oui.js").OuiTable, online: Set<string>, gateway: string | null,
 *   self: string | null, ports: Record<string, { open: number[] }> }} context
 * @returns {Device[]}
 */
export function devicesOf(records, context) {
  return Object.entries(records)
    .map(([mac, r]) => {
      const randomMac = isRandomMac(mac);
      const vendor = vendorOf(context.oui, mac);
      const gateway = mac === context.gateway;
      const self = mac === context.self;
      const open = context.ports[mac]?.open ?? null;
      const risky = (open ?? []).filter((p) => isRisky(p, gateway));
      const guessed = guessKind({
        name: r.mdns ?? null,
        vendor,
        ports: open ?? [],
        randomMac,
        gateway,
        self,
      });
      const known = r.known === true || gateway || self;
      /** @type {Status} */
      const status = risky.length > 0 ? "caution" : known ? "known" : "new";
      const online = context.online.has(mac);
      const ping = online ? (r.ping ?? null) : null;
      return {
        mac,
        ip: r.ip,
        name: r.name ?? null,
        mdns: r.mdns ?? null,
        vendor,
        randomMac,
        kind: isKind(r.kind) ? r.kind : guessed,
        kindGuessed: !isKind(r.kind),
        mine: r.mine === true,
        known,
        gateway,
        self,
        online,
        ping,
        speed: speedOf(ping),
        first: r.first,
        last: r.last,
        status,
        open,
        risky,
      };
    })
    .sort((a, b) => Number(b.gateway) - Number(a.gateway) || compareIp(a.ip, b.ip));
}

/** A risky port: high always, an admin screen unless it is the router's own. @param {number} port @param {boolean} gateway */
export function isRisky(port, gateway) {
  const { risk } = portInfo(port);
  return risk === "high" || (risk === "admin" && !gateway);
}

/**
 * What the person named the device, else its mDNS name, else null (the view then says its kind
 * and manufacturer).
 * @param {Pick<Device, "name" | "mdns">} d
 */
export function nameOf(d) {
  return d.name ?? d.mdns ?? null;
}

/**
 * The "Who is this?" answer applied to a record: a name, a kind and whether it is the person's own.
 * Naming a device makes it known.
 * @param {DeviceRecord} record
 * @param {{ name?: string, kind?: string, mine?: boolean }} answer
 * @returns {DeviceRecord}
 */
export function nameDevice(record, answer) {
  const next = { ...record, known: true };
  if (typeof answer.name === "string") {
    const name = answer.name.trim().slice(0, 60);
    if (name) next.name = name;
    else delete next.name;
  }
  if (isKind(answer.kind)) next.kind = answer.kind;
  if (typeof answer.mine === "boolean") next.mine = answer.mine;
  return next;
}
