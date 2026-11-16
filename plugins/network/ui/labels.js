// How a device reads in words wherever it is named: its label, its ping and its manufacturer.
import { nameOf } from "./devices.js";

/**
 * @typedef {import("./devices.js").Device} Device
 * @typedef {(id: string, params?: Record<string, unknown>) => string} T
 */

/** How a device is called on the map and in lists. @param {T} t @param {Device} d */
export function labelOf(t, d) {
  if (d.gateway) return nameOf(d) ?? t("map.router");
  if (d.self) return nameOf(d) ?? t("device.self");
  return nameOf(d) ?? t("device.unnamed", { kind: t(`kind.${d.kind}`), ip: d.ip });
}

/** The ping as people read it. @param {T} t @param {Device} d */
export function pingText(t, d) {
  if (d.self) return "—";
  if (d.ping === null) return t("speed.none");
  return t("device.pingValue", { ms: Math.round(d.ping * 10) / 10, speed: t(`speed.${d.speed}`) });
}

/** @param {T} t @param {Device} d */
export function vendorText(t, d) {
  return d.randomMac ? t("device.randomMac") : (d.vendor ?? t("device.vendorUnknown"));
}
