// From the programs' output to the devices a person reads (NET-04–07, NET-15): the scan on the
// fixtures' Mac, the device list, the map's model, new, returning and departing devices, the log.
import { describe, expect, it } from "vitest";
import { devicesOf, GONE_MS, mergeScan, nameDevice, speedOf } from "../ui/devices.js";
import { appendLog, LOG_BYTES, timelineData } from "../ui/journal.js";
import { gridFor, mapModel } from "../ui/layout.js";
import { parseOui } from "../ui/oui.js";
import { scanNetwork } from "../ui/probe.js";
import * as F from "./fixtures";
import { englishT, macRunner } from "./harness";

const oui = parseOui(F.OUI);
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 17, 0, minutes)).toISOString();

async function look(admin: boolean, minutes = 0, arp = F.ARP) {
  const runner = macRunner({ arp });
  const scan = await scanNetwork(runner as never, {
    admin: async () => admin,
    now: () => at(minutes),
  });
  return { scan, runner };
}

function devicesAfter(records: Record<string, any>, scan: any, ports = {}) {
  return devicesOf(records, {
    oui,
    online: new Set(scan.seen.map((s: any) => s.mac)),
    gateway: scan.gateway.mac,
    self: scan.self.mac,
    ports,
  });
}

describe("a scan", () => {
  it("sweeps a /24 the person administers, then reads the ARP table and the mDNS names", async () => {
    const { scan, runner } = await look(true);
    expect(scan.here).toMatchObject({
      iface: "en0",
      cidr: "192.168.0.0/24",
      gateway: { ip: "192.168.0.1", mac: "00:0a:eb:01:02:03" },
      self: { ip: "192.168.0.10", mac: "f0:d1:a9:10:00:0a" },
      id: "gw-000aeb010203",
    });
    expect(scan.swept).toBe(true);
    const pings = runner.calls.filter((c) => c.program === "ping");
    expect(pings).toHaveLength(253);
    expect(pings[0]!.args).toEqual(["-n", "-q", "-c", "1", "-W", "800", "-t", "2", "192.168.0.1"]);
    expect(runner.calls.filter((c) => c.program === "arp")).toHaveLength(2);
    // Only this network's devices: en1's 10.0.5.2 and link-local addresses are not in it.
    expect(scan.seen.map((s) => s.ip)).toEqual([
      "192.168.0.1",
      "192.168.0.21",
      "192.168.0.23",
      "192.168.0.31",
      "192.168.0.42",
      "192.168.0.10",
    ]);
    expect(scan.seen.find((s) => s.ip === "192.168.0.21")).toMatchObject({
      ping: 35,
      mdns: "raspberrypi",
    });
    expect(runner.calls.every((c) => !c.args.includes("10.0.5.2"))).toBe(true);
  });

  it("without the administrator's yes reads the ARP table and pings only the router", async () => {
    const { scan, runner } = await look(false);
    expect(scan.swept).toBe(false);
    const pings = runner.calls.filter((c) => c.program === "ping");
    expect(pings.map((c) => c.args.at(-1))).toEqual(["192.168.0.1"]);
    expect(runner.calls.some((c) => c.program === "dig")).toBe(false);
    expect(scan.seen).toHaveLength(6);
  });

  it("on a network wider than /24 sweeps nothing and pings what the ARP table holds", async () => {
    const runner = macRunner({ ifconfig: F.IFCONFIG_WIDE });
    const scan = await scanNetwork(runner as never, { admin: async () => true, now: () => at(0) });
    expect(scan.swept).toBe(false);
    expect(scan.wide).toBe(true);
    expect(scan.here.cidr).toBe("192.168.0.0/16");
    expect(runner.calls.filter((c) => c.program === "ping")).toHaveLength(6);
  });
});

describe("the devices", () => {
  it("lists each device with its IP address, MAC address, manufacturer, ping and kind", async () => {
    const { scan } = await look(true);
    const { records, events } = mergeScan({}, scan);
    expect(events).toEqual([{ kind: "first", at: at(0), count: 6 }]);
    const devices = devicesAfter(records, scan);
    expect(devices.map((d) => [d.ip, d.vendor, d.kind, d.status, d.speed])).toEqual([
      ["192.168.0.1", "TP-Link", "router", "known", "fast"],
      ["192.168.0.10", "Apple", "computer", "known", "none"],
      ["192.168.0.21", "Raspberry Pi Foundation", "computer", "new", "ok"],
      ["192.168.0.23", "Hangzhou Hikvision Digital", "camera", "new", "slow"],
      ["192.168.0.31", "Google", "unknown", "new", "none"],
      ["192.168.0.42", null, "phone", "new", "none"],
    ]);
    const phone = devices.find((d) => d.ip === "192.168.0.42");
    expect(phone).toMatchObject({ randomMac: true, vendor: null, first: at(0), last: at(0) });
    expect(speedOf(19.9)).toBe("fast");
    expect(speedOf(99)).toBe("ok");
    expect(speedOf(100)).toBe("slow");
  });

  it("calls a device new only when the network has shown it before, and notes who returns and who left", async () => {
    const first = mergeScan({}, (await look(true, 0)).scan);
    const withLaptop = `${F.ARP}? (192.168.0.77) at a4:83:e7:01:02:03 on en0 ifscope [ethernet]\n`;
    const second = mergeScan(first.records, (await look(true, 5, withLaptop)).scan);
    expect(second.events).toEqual([
      { kind: "new", at: at(5), mac: "a4:83:e7:01:02:03", ip: "192.168.0.77" },
    ]);
    const without = F.ARP.replace(/^.*192\.168\.0\.77.*$/m, "");
    const soon = mergeScan(second.records, (await look(true, 10, without)).scan);
    expect(soon.events).toEqual([]);
    const later = mergeScan(second.records, (await look(true, 5 + GONE_MS / 60000, without)).scan);
    expect(later.events).toEqual([
      { kind: "gone", at: at(20), mac: "a4:83:e7:01:02:03", ip: "192.168.0.77" },
    ]);
    expect(later.records["a4:83:e7:01:02:03"]!.gone).toBe(true);
    const back = mergeScan(later.records, (await look(true, 30, withLaptop)).scan);
    expect(back.events).toEqual([
      { kind: "back", at: at(30), mac: "a4:83:e7:01:02:03", ip: "192.168.0.77" },
    ]);
    expect(back.records["a4:83:e7:01:02:03"]).toMatchObject({ first: at(5), last: at(30) });
  });

  it("takes the person's name, kind and 'mine', and then knows the device", async () => {
    const { scan } = await look(true);
    const { records } = mergeScan({}, scan);
    const mac = "00:bc:99:12:34:56";
    const named = {
      ...records,
      [mac]: nameDevice(records[mac]!, { name: "Living room camera", kind: "camera", mine: true }),
    };
    const camera = devicesAfter(named, scan).find((d) => d.mac === mac);
    expect(camera).toMatchObject({
      name: "Living room camera",
      kind: "camera",
      kindGuessed: false,
      mine: true,
      status: "known",
    });
    const risky = devicesAfter(named, scan, { [mac]: { open: [23, 80] } }).find(
      (d) => d.mac === mac,
    );
    expect(risky).toMatchObject({ status: "caution", risky: [23] });
  });
});

describe("the map", () => {
  it("puts the router in the middle and the devices around it, nearest ring first", async () => {
    const { scan } = await look(true);
    const devices = devicesAfter(mergeScan({}, scan).records, scan);
    const map = mapModel(devices);
    expect(map.router?.ip).toBe("192.168.0.1");
    expect([map.cols, map.rows]).toEqual([3, 3]);
    expect(map.center).toEqual({ row: 1, col: 1 });
    expect(map.cells.map((c) => [c.device.ip, c.row, c.col])).toEqual([
      ["192.168.0.10", 0, 1],
      ["192.168.0.21", 1, 2],
      ["192.168.0.23", 2, 1],
      ["192.168.0.31", 1, 0],
      ["192.168.0.42", 0, 2],
    ]);
    expect(map.cells.every((c) => !(c.row === 1 && c.col === 1))).toBe(true);
    expect(gridFor(8)).toEqual({ cols: 3, rows: 3 });
    expect(gridFor(9)).toEqual({ cols: 5, rows: 3 });
    expect(gridFor(24)).toEqual({ cols: 5, rows: 5 });
    expect(gridFor(30)).toEqual({ cols: 7, rows: 5 });
  });
});

describe("the log", () => {
  it("keeps the newest entries under the store's limit and draws them newest first", async () => {
    const t = await englishT();
    const many = Array.from({ length: 2000 }, (_, i) => ({
      kind: "new" as const,
      at: at(i),
      mac: "a4:83:e7:01:02:03",
      ip: "192.168.0.77",
    }));
    const log = appendLog([], many);
    expect(log.length).toBeLessThanOrEqual(400);
    expect(new TextEncoder().encode(JSON.stringify(log)).length).toBeLessThan(LOG_BYTES);
    expect(log.at(-1)?.at).toBe(at(1999));
    const data = timelineData(
      [{ kind: "first", at: at(0), count: 6 }, ...many.slice(-2)],
      new Map(),
      t,
    );
    expect(data.entries.map((e) => e.start)).toEqual([at(1999), at(1998), at(0)]);
    expect(data.entries[0]!.title).toContain("192.168.0.77");
    expect(data.entries[2]!.title).toContain("6");
  });
});
