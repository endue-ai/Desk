// The score and the cards (NET-09–11) from port check results, and the port check itself over a
// fake net.connect: connect, close at once, send nothing.
import { describe, expect, it } from "vitest";
import { cardLabel, checkup, stepsFor } from "../ui/checkup.js";
import { devicesOf, mergeScan } from "../ui/devices.js";
import { networkOf, parseIp } from "../ui/ipv4.js";
import { parseOui } from "../ui/oui.js";
import { checkPorts, PORTS, scopeFor } from "../ui/ports.js";
import { scanNetwork } from "../ui/probe.js";
import { NetworkRefusal } from "../ui/refusal.js";
import * as F from "./fixtures";
import { englishT, fakeBridge, macRunner } from "./harness";

const AT = "2026-11-17T00:00:00.000Z";
const CAMERA = "00:bc:99:12:34:56";
const PI = "b8:27:eb:aa:bb:cc";
const ROUTER = "00:0a:eb:01:02:03";

async function devicesWith(ports: Record<string, { open: number[] }>, known: string[] = []) {
  const scan = await scanNetwork(macRunner() as never, { admin: async () => true, now: () => AT });
  const { records } = mergeScan({}, scan);
  for (const mac of known) records[mac] = { ...records[mac]!, known: true };
  records[CAMERA] = { ...records[CAMERA]!, name: "Living room camera" };
  return devicesOf(records, {
    oui: parseOui(F.OUI),
    online: new Set(scan.seen.map((s) => s.mac)),
    gateway: scan.gateway.mac,
    self: scan.self.mac,
    ports,
  });
}

describe("the checkup", () => {
  it("takes points off for unknown devices, risky open ports and the Wi-Fi security mode", async () => {
    const t = await englishT();
    const devices = await devicesWith({
      [CAMERA]: { open: [23, 80, 554] },
      [PI]: { open: [22, 8080] },
      [ROUTER]: { open: [53, 80, 443, 8080] },
    });
    const result = checkup(devices, { security: "wpa2-personal", applies: true }, (d) =>
      cardLabel(t, d),
    );
    // Unknown: the Google device and the phone, 2 × 5 (the camera and the Pi need attention instead).
    // Ports: Telnet on the camera 15, the Pi's admin page on 8080 8; the router's own admin is fine.
    // Wi-Fi: WPA2 5.
    expect(result.items).toEqual([
      { id: "unknown", points: 10, max: 25, count: 2 },
      { id: "ports", points: 23, max: 50, count: 2 },
      { id: "wifi", points: 5, max: 25, count: 1, level: "wpa2" },
    ]);
    expect(result.score).toBe(100 - 10 - 23 - 5);
    expect(result.grade).toBe("poor");
    expect(result.cards.map((c) => c.id)).toEqual([
      `port:${CAMERA}:23`,
      "unknown",
      `port:${PI}:8080`,
      "wifi",
      "unchecked",
    ]);
    const telnet = result.cards[0]!;
    expect(t(telnet.key, telnet.params)).toBe("Living room camera: port 23 (Telnet) is open.");
    expect(telnet.steps).toBe("steps.telnet");
    expect(t(result.cards[2]!.key, result.cards[2]!.params)).toBe(
      "raspberrypi: an admin page is open on port 8080 (HTTP).",
    );
    expect(result.checked).toBe(3);
    expect(result.unchecked).toBe(2);
  });

  it("caps each item and never goes below zero", async () => {
    const t = await englishT();
    const open = { open: [21, 23, 139, 445, 3389, 5900] };
    const devices = await devicesWith({ [CAMERA]: open, [PI]: open });
    const result = checkup(devices, { security: "none", applies: true }, (d) => cardLabel(t, d));
    expect(result.items.map((i) => i.points)).toEqual([10, 50, 25]);
    expect(result.score).toBe(15);
    const worse = checkup(
      [
        ...devices,
        ...Array.from({ length: 6 }, (_, i) => ({ ...devices[5]!, mac: `6a:00:00:00:00:0${i}` })),
      ],
      { security: "wep", applies: true },
      (d) => cardLabel(t, d),
    );
    expect(worse.items[0]!.points).toBe(25);
    expect(worse.score).toBe(0);
  });

  it("scores 100 on a known network with nothing open and WPA3, and leaves Ethernet's Wi-Fi out", async () => {
    const t = await englishT();
    const all = ["b8:27:eb:aa:bb:cc", CAMERA, "3c:5a:b4:00:11:22", "6a:1f:2e:3d:4c:5b"];
    const closed = Object.fromEntries([...all, ROUTER].map((mac) => [mac, { open: [] }]));
    const devices = await devicesWith(closed, all);
    const wpa3 = checkup(devices, { security: "wpa3-personal", applies: true }, (d) =>
      cardLabel(t, d),
    );
    expect(wpa3).toMatchObject({ score: 100, grade: "good", cards: [] });
    const wired = checkup(devices, { security: "", applies: false }, (d) => cardLabel(t, d));
    expect(wired.items[2]).toEqual({ id: "wifi", points: 0, max: 25, count: 0, level: "not-wifi" });
  });

  it("knows how each risky service is closed", () => {
    expect([23, 21, 445, 3389, 5900, 8443, 2323].map(stepsFor)).toEqual([
      "steps.telnet",
      "steps.ftp",
      "steps.smb",
      "steps.rdp",
      "steps.vnc",
      "steps.admin",
      "steps.telnet",
    ]);
  });
});

describe("the port check", () => {
  const network = networkOf(parseIp("192.168.0.10") as number, 24);

  it("asks for the device's ports, connects to a few dozen and closes each at once", async () => {
    const open = new Set([23, 80]);
    let nextId = 0;
    const bridge = fakeBridge({
      "perm.request": () => ({ granted: true }),
      "net.connect": ({ port }) => {
        if (open.has(port)) return { socketId: `s-${nextId++}` };
        if (port === 22) throw Object.assign(new Error("timeout"), { code: "timeout" });
        throw Object.assign(new Error("refused"), { code: "io_error" });
      },
      "net.close": () => ({}),
    });
    const result = await checkPorts(bridge, {
      ip: "192.168.0.23",
      network,
      reason: "why",
      now: () => AT,
    });
    expect(result).toEqual({ open: [23, 80], closed: PORTS.length - 3, silent: 1, at: AT });
    expect(PORTS.length).toBeGreaterThanOrEqual(30);
    expect(PORTS.length).toBeLessThanOrEqual(50);
    const ask = bridge.calls.find((c) => c.method === "perm.request");
    expect(ask?.params).toEqual({
      permission: scopeFor("192.168.0.23"),
      reason: "why",
      duration: "always",
    });
    const connects = bridge.calls.filter((c) => c.method === "net.connect");
    expect(connects).toHaveLength(PORTS.length);
    expect(
      connects.every((c) => c.params.host === "192.168.0.23" && c.params.timeoutMs <= 1500),
    ).toBe(true);
    expect(bridge.calls.filter((c) => c.method === "net.close")).toHaveLength(2);
    expect(bridge.calls.some((c) => c.method === "net.send")).toBe(false);
  });

  it("refuses a public address and another range before asking anything", async () => {
    for (const ip of ["8.8.8.8", "192.168.1.5", "10.0.5.2"]) {
      const bridge = fakeBridge();
      await expect(checkPorts(bridge, { ip, network, reason: "why" })).rejects.toBeInstanceOf(
        NetworkRefusal,
      );
      expect(bridge.calls).toEqual([]);
    }
  });

  it("stops when the person says no", async () => {
    const bridge = fakeBridge({ "perm.request": () => ({ granted: false }) });
    await expect(
      checkPorts(bridge, { ip: "192.168.0.23", network, reason: "why" }),
    ).rejects.toMatchObject({
      code: "ports-denied",
      params: { ip: "192.168.0.23" },
    });
    expect(bridge.calls.some((c) => c.method === "net.connect")).toBe(false);
  });
});
