// The readers of macOS's programs on their own output, and the address rules every probe keeps.
import { describe, expect, it } from "vitest";
import {
  networkOf,
  networkRefusal,
  parseIp,
  prefixOfMask,
  sweepHosts,
  targetRefusal,
} from "../ui/ipv4.js";
import { isRandomMac, parseOui, vendorOf } from "../ui/oui.js";
import {
  normalizeMac,
  parseArp,
  parseIfconfig,
  parseMdnsName,
  parsePing,
  parseRoute,
} from "../ui/parse.js";
import { parseChannel, parseWifi, securityLevel } from "../ui/wifi.js";
import * as F from "./fixtures";

describe("the programs' output", () => {
  it("reads the default route and the interface with its prefix", () => {
    expect(parseRoute(F.ROUTE)).toEqual({ gateway: "192.168.0.1", iface: "en0" });
    expect(parseRoute(F.ROUTE_NONE)).toBeNull();
    expect(parseIfconfig(F.IFCONFIG)).toEqual({
      ip: "192.168.0.10",
      prefix: 24,
      mac: "f0:d1:a9:10:00:0a",
      active: true,
    });
    expect(prefixOfMask("0xffff0000")).toBe(16);
    expect(prefixOfMask("255.255.255.128")).toBe(25);
    expect(prefixOfMask("0xff00ff00")).toBeNull();
  });

  it("reads the ARP table with full MAC addresses and leaves out what names no device", () => {
    const entries = parseArp(F.ARP);
    expect(entries.map((e) => `${e.iface} ${e.ip} ${e.mac}`)).toEqual([
      "en0 192.168.0.1 00:0a:eb:01:02:03",
      "en0 192.168.0.10 f0:d1:a9:10:00:0a",
      "en0 192.168.0.21 b8:27:eb:aa:bb:cc",
      "en0 192.168.0.23 00:bc:99:12:34:56",
      "en0 192.168.0.31 3c:5a:b4:00:11:22",
      "en0 192.168.0.42 6a:1f:2e:3d:4c:5b",
      "en1 10.0.5.2 1c:1b:0d:df:18:0d",
    ]);
    expect(entries.find((e) => e.ip === "192.168.0.10")?.permanent).toBe(true);
    expect(normalizeMac("1c:1b:d:df:18:d")).toBe("1c:1b:0d:df:18:0d");
    expect(normalizeMac("not a mac")).toBeNull();
  });

  it("reads a ping's round trip and an mDNS name", () => {
    expect(parsePing(F.pingReply(2.5))).toBe(2.5);
    expect(parsePing(F.PING_LINE)).toBe(3.412);
    expect(parsePing(F.PING_NONE)).toBeNull();
    expect(parseMdnsName(F.DIG_NAME)).toBe("Studio-iMac");
    expect(parseMdnsName(F.DIG_NONE)).toBeNull();
  });

  it("reads the Wi-Fi report: the joined network, the networks around, and hidden SSIDs", () => {
    const report = parseWifi(F.WIFI);
    expect(report?.on).toBe(true);
    expect(report?.iface).toBe("en1");
    expect(report?.hidden).toBe(true);
    expect(report?.current).toMatchObject({
      ssid: null,
      channel: 6,
      band: "2.4",
      width: 20,
      security: "wpa2-personal",
      rssi: -58,
      noise: -92,
      rate: 144,
    });
    expect(report?.nearby).toHaveLength(9);
    expect(report?.nearby.every((n) => n.ssid === null)).toBe(true);
    expect(parseWifi(F.WIFI_NAMED)?.current?.ssid).toBe("Home");
    expect(parseWifi(F.WIFI_OFF)).toMatchObject({ on: false, current: null, nearby: [] });
    expect(parseWifi("not json")).toBeNull();
    expect(parseChannel("97 (6GHz, 160MHz)")).toEqual({ channel: 97, band: "6", width: 160 });
    expect(parseChannel("1 (2GHz, 40MHz)")).toEqual({ channel: 1, band: "2.4", width: 40 });
  });

  it("weighs a Wi-Fi security mode", () => {
    expect(securityLevel("none")).toEqual({ level: "open", points: 25 });
    expect(securityLevel("wep")).toEqual({ level: "wep", points: 25 });
    expect(securityLevel("wpa-personal")).toEqual({ level: "wpa", points: 15 });
    expect(securityLevel("wpa2-personal-mixed")).toEqual({ level: "mixed", points: 10 });
    expect(securityLevel("wpa2-personal")).toEqual({ level: "wpa2", points: 5 });
    expect(securityLevel("wpa3-personal")).toEqual({ level: "wpa3", points: 0 });
    expect(securityLevel("wpa3-transition")).toEqual({ level: "wpa3", points: 0 });
    expect(securityLevel("wpa2-enterprise")).toEqual({ level: "enterprise", points: 0 });
  });
});

describe("manufacturers", () => {
  const table = parseOui(F.OUI);
  it("names a manufacturer from the OUI and none for a random MAC address", () => {
    expect(vendorOf(table, "f0:d1:a9:10:00:0a")).toBe("Apple");
    expect(vendorOf(table, "00:bc:99:12:34:56")).toBe("Hangzhou Hikvision Digital");
    expect(isRandomMac("6a:1f:2e:3d:4c:5b")).toBe(true);
    expect(vendorOf(table, "6a:1f:2e:3d:4c:5b")).toBeNull();
    expect(vendorOf(table, "00:11:22:33:44:55")).toBeNull();
  });
});

describe("only the private network this computer is on", () => {
  const net = networkOf(parseIp("192.168.0.10") as number, 24);
  it("refuses public addresses, other ranges and the network's own addresses", () => {
    expect(targetRefusal("192.168.0.23", net)).toBeNull();
    expect(targetRefusal("8.8.8.8", net)).toBe("public");
    expect(targetRefusal("203.0.113.5", net)).toBe("public");
    expect(targetRefusal("100.64.0.1", net)).toBe("public");
    expect(targetRefusal("169.254.4.118", net)).toBe("public");
    expect(targetRefusal("10.0.5.2", net)).toBe("other-range");
    expect(targetRefusal("192.168.1.5", net)).toBe("other-range");
    expect(targetRefusal("192.168.0.255", net)).toBe("other-range");
    expect(targetRefusal("192.168.0.0", net)).toBe("other-range");
    expect(targetRefusal("192.168.0.300", net)).toBe("invalid");
    expect(targetRefusal("192.168.0.5", null)).toBe("no-network");
  });

  it("sweeps a /24 but not this computer, and never a wider network", () => {
    const hosts = sweepHosts(net, parseIp("192.168.0.10") as number);
    expect(hosts).toHaveLength(253);
    expect(sweepHosts(networkOf(parseIp("192.168.0.10") as number, 16))).toBeNull();
    expect(sweepHosts(networkOf(parseIp("172.20.1.4") as number, 23))).toBeNull();
    expect(sweepHosts(networkOf(parseIp("10.1.2.3") as number, 26))).toHaveLength(62);
    expect(networkRefusal(networkOf(parseIp("203.0.113.10") as number, 24))).toBe("public");
  });
});
