// The log (NET-15): new, returning and departing devices in time order, kept in the plugin's own
// store under one value (64 KiB at most, so only the latest entries stay), and drawn as a universal
// timeline (ADR 0087).
import { nameOf } from "./devices.js";

/**
 * @typedef {import("./devices.js").DeviceEvent} DeviceEvent
 * @typedef {import("./devices.js").Device} Device
 */

/** The value the log is kept in stays under this many bytes of JSON. */
export const LOG_BYTES = 60 * 1024;
export const LOG_MAX = 400;

/**
 * The log with `events` added, oldest first, cut to the newest entries that fit.
 * @param {DeviceEvent[]} log
 * @param {DeviceEvent[]} events
 */
export function appendLog(log, events, max = LOG_MAX, bytes = LOG_BYTES) {
  let next = [...log, ...events].slice(-max);
  while (next.length > 1 && new TextEncoder().encode(JSON.stringify(next)).length > bytes)
    next = next.slice(Math.ceil(next.length / 10));
  return next;
}

/**
 * The log as universal data for a timeline: one entry per event, newest first, with what the
 * person called the device when they named it.
 * @param {DeviceEvent[]} log
 * @param {Map<string, Device>} devices
 * @param {(id: string, params?: Record<string, unknown>) => string} t
 */
export function timelineData(log, devices, t) {
  const entries = [...log].reverse().map((e, i) => {
    const d = e.mac ? devices.get(e.mac) : undefined;
    const who = d
      ? (nameOf(d) ?? t("device.unnamed", { kind: t(`kind.${d.kind}`), ip: d.ip }))
      : (e.ip ?? "");
    return {
      id: `${e.at}-${i}`,
      title: t(`log.${e.kind}`, { device: who, count: e.count ?? 0 }),
      start: e.at,
      group: t(`log.group.${e.kind}`),
      status: e.kind === "new" ? "waiting" : e.kind === "gone" ? "pending" : "done",
      ...(e.mac
        ? {
            text: t("log.detail", { ip: e.ip ?? "", mac: e.mac }),
            mac: e.mac,
          }
        : {}),
    };
  });
  return { universal: /** @type {const} */ ("v0"), title: t("tab.log"), entries };
}
