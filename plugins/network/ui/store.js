// What the plugin keeps, on this computer only, in its own store (NET-17): per network its devices,
// its port checks and its log, and once for all networks whether the person administers each. Every
// value stays under the store's 64 KiB: the longest-unseen devices and the oldest log entries go.
import { trimRecords } from "./devices.js";
import { appendLog, LOG_BYTES } from "./journal.js";

/**
 * @typedef {import("./devices.js").Records} Records
 * @typedef {import("./devices.js").DeviceEvent} DeviceEvent
 * @typedef {import("./ports.js").PortResult} PortResult
 * @typedef {{ admin?: boolean, cidr: string, first: string, last?: string }} NetworkRecord
 * @typedef {{ call(method: string, params: any): Promise<any> }} Bridge
 */

export const VALUE_BYTES = 60 * 1024;

/** @param {unknown} value */
const bytesOf = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

/** Records cut until they fit one value. @param {Records} records */
export function fitRecords(records) {
  let next = records;
  let max = Object.keys(next).length;
  while (max > 1 && bytesOf(next) > VALUE_BYTES) {
    max = Math.floor(max * 0.9);
    next = trimRecords(next, max);
  }
  return next;
}

/** @param {Bridge} bridge */
export function createStore(bridge) {
  /** @param {string} key */
  const get = async (key) => {
    const answer = await bridge.call("store.get", { key }).catch(() => ({}));
    return answer?.value;
  };
  /** @param {string} key @param {unknown} value */
  const set = (key, value) => bridge.call("store.set", { key, value }).catch(() => {});

  return {
    /** @returns {Promise<Record<string, NetworkRecord>>} */
    async networks() {
      const value = await get("networks");
      return value && typeof value === "object" ? /** @type {any} */ (value) : {};
    },
    /** @param {Record<string, NetworkRecord>} value */
    saveNetworks: (value) => set("networks", value),
    /** @param {string} id @returns {Promise<Records>} */
    async devices(id) {
      const value = await get(`devices.${id}`);
      return value && typeof value === "object" ? /** @type {any} */ (value) : {};
    },
    /** @param {string} id @param {Records} records */
    saveDevices: (id, records) => set(`devices.${id}`, fitRecords(records)),
    /** @param {string} id @returns {Promise<Record<string, PortResult>>} */
    async ports(id) {
      const value = await get(`ports.${id}`);
      return value && typeof value === "object" ? /** @type {any} */ (value) : {};
    },
    /** @param {string} id @param {Record<string, PortResult>} value */
    savePorts: (id, value) => set(`ports.${id}`, value),
    /** @param {string} id @returns {Promise<DeviceEvent[]>} */
    async log(id) {
      const value = await get(`log.${id}`);
      return Array.isArray(value) ? value : [];
    },
    /** Add events and keep the newest that fit. @param {string} id @param {DeviceEvent[]} log @param {DeviceEvent[]} events */
    async appendLog(id, log, events) {
      const next = appendLog(log, events, undefined, LOG_BYTES);
      await set(`log.${id}`, next);
      return next;
    },
  };
}

/** @typedef {ReturnType<typeof createStore>} NetworkStore */
