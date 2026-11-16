// The checkup (NET-09, NET-10, NET-11): a score out of 100 and the cards that say what to do. The
// formula is written in docs/ko/network-plugin-requirements.md as NET-10:
//   100 − unknown devices (5 each, at most 25)
//       − risky open ports (15 each for Telnet, FTP, SMB, RDP and VNC, 8 for an admin screen on a
//         port other than 80 and 443; at most 50)
//       − my Wi-Fi's security mode (open or WEP 25, WPA 15, WPA/WPA2 mixed 10, WPA2 5, WPA3 0; at
//         most 25; 0 and a note when this network is not the Wi-Fi this computer is joined to)
// Cards are values: a message id and its parameters, so the view, the commands and the brain's
// "Explain simply" read the same thing.
import { nameOf } from "./devices.js";
import { portInfo } from "./ports.js";
import { securityLevel } from "./wifi.js";

/**
 * @typedef {import("./devices.js").Device} Device
 * @typedef {{ id: "unknown" | "ports" | "wifi", points: number, max: number, count: number,
 *   level?: string }} ScoreItem
 * @typedef {{ id: string, kind: "port" | "unknown" | "wifi" | "unchecked", points: number,
 *   key: string, params: Record<string, string | number>, steps: string, mac?: string, port?: number }} Card
 * @typedef {{ score: number, grade: "good" | "fair" | "poor", items: ScoreItem[], cards: Card[],
 *   checked: number, unchecked: number }} Checkup
 */

export const UNKNOWN_EACH = 5;
export const UNKNOWN_MAX = 25;
export const HIGH_EACH = 15;
export const ADMIN_EACH = 8;
export const PORTS_MAX = 50;
export const WIFI_MAX = 25;

/** good at 90 and above, fair from 70, poor below. @param {number} score */
export function gradeOf(score) {
  return score >= 90 ? "good" : score >= 70 ? "fair" : "poor";
}

/** What closing a port takes, by its service: the steps' message id. @param {number} port */
export function stepsFor(port) {
  const { service, risk } = portInfo(port);
  if (risk === "admin") return "steps.admin";
  if (service.startsWith("Telnet")) return "steps.telnet";
  if (service === "FTP") return "steps.ftp";
  if (service.startsWith("SMB")) return "steps.smb";
  if (service === "RDP") return "steps.rdp";
  if (service === "VNC") return "steps.vnc";
  return "steps.admin";
}

/**
 * Score the network and list what to do, the heaviest first.
 * @param {Device[]} devices The network's devices (devicesOf); only those online count.
 * @param {{ security: string, applies: boolean, read?: boolean }} wifi `applies` when this network is
 *   the Wi-Fi this computer is joined to; `read` false while the Wi-Fi report has not been read.
 * @param {(d: Device) => string} label How a card names a device.
 * @returns {Checkup}
 */
export function checkup(devices, wifi, label) {
  const online = devices.filter((d) => d.online);
  /** @type {Card[]} */
  const cards = [];

  const unknown = online.filter((d) => d.status === "new");
  const unknownPoints = Math.min(UNKNOWN_MAX, unknown.length * UNKNOWN_EACH);
  if (unknown.length > 0)
    cards.push({
      id: "unknown",
      kind: "unknown",
      points: unknownPoints,
      key: "card.unknown",
      params: { count: unknown.length },
      steps: "steps.unknown",
    });

  let portPoints = 0;
  let riskyCount = 0;
  for (const d of online) {
    for (const port of d.risky) {
      const { service, risk } = portInfo(port);
      const points = risk === "high" ? HIGH_EACH : ADMIN_EACH;
      portPoints += points;
      riskyCount++;
      cards.push({
        id: `port:${d.mac}:${port}`,
        kind: "port",
        points,
        key: risk === "high" ? "card.port" : "card.admin",
        params: { device: label(d), port, service },
        steps: stepsFor(port),
        mac: d.mac,
        port,
      });
    }
  }
  portPoints = Math.min(PORTS_MAX, portPoints);

  const { level, points: securityPoints } = securityLevel(wifi.security);
  const wifiPoints = wifi.applies ? Math.min(WIFI_MAX, securityPoints) : 0;
  if (wifi.applies && securityPoints > 0)
    cards.push({
      id: "wifi",
      kind: "wifi",
      points: wifiPoints,
      key: `card.wifi.${level}`,
      params: {},
      steps: level === "wpa2" ? "steps.wpa3" : "steps.wifi",
    });

  const unchecked = online.filter((d) => d.open === null && !d.self);
  if (unchecked.length > 0)
    cards.push({
      id: "unchecked",
      kind: "unchecked",
      points: 0,
      key: "card.unchecked",
      params: { count: unchecked.length },
      steps: "steps.unchecked",
    });

  // Heaviest first; on a tie a port before the Wi-Fi before unknown devices.
  const rank = { port: 0, wifi: 1, unknown: 2, unchecked: 3 };
  cards.sort((a, b) => b.points - a.points || rank[a.kind] - rank[b.kind]);
  const score = Math.max(0, 100 - unknownPoints - portPoints - wifiPoints);
  return {
    score,
    grade: gradeOf(score),
    items: [
      { id: "unknown", points: unknownPoints, max: UNKNOWN_MAX, count: unknown.length },
      { id: "ports", points: portPoints, max: PORTS_MAX, count: riskyCount },
      {
        id: "wifi",
        points: wifiPoints,
        max: WIFI_MAX,
        count: wifi.applies ? 1 : 0,
        level: wifi.read === false ? "unknown" : wifi.applies ? level : "not-wifi",
      },
    ],
    cards,
    checked: online.filter((d) => d.open !== null).length,
    unchecked: unchecked.length,
  };
}

/** A device as a card names it: what the person called it, else its kind and its address. */
export function cardLabel(
  /** @type {(id: string, params?: Record<string, unknown>) => string} */ t,
  /** @type {Device} */ d,
) {
  return nameOf(d) ?? t("device.unnamed", { kind: t(`kind.${d.kind}`), ip: d.ip });
}
