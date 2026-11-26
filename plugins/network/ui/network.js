// The controller: one network at a time, the one this computer is on now. It asks the person once
// per network whether they administer it (NET-03) and sweeps nothing until they say yes; it merges
// each look into what it kept, tells the person about new devices (ui.notify), checks a device's
// ports when asked, reads the Wi-Fi around and looks again every few minutes while it is on.

import { channelsModel } from "./channels.js";
import { cardLabel, checkup } from "./checkup.js";
import { devicesOf, mergeScan, nameDevice } from "./devices.js";
import { allowPorts, checkPorts } from "./ports.js";
import { networkId, readWifi, scanNetwork } from "./probe.js";
import { isRefusal, NetworkRefusal } from "./refusal.js";

/**
 * @typedef {import("./devices.js").Device} Device
 * @typedef {import("./probe.js").Here} Here
 * @typedef {import("./wifi.js").WifiReport} WifiReport
 * @typedef {{ busy: null | { phase: string, done: number, total: number }, here: Here | null,
 *   admin: boolean | undefined, devices: Device[], refusal: NetworkRefusal | null, scanned: string | null,
 *   wifi: WifiReport | null, wifiRefusal: NetworkRefusal | null, swept: boolean, wide: boolean,
 *   log: import("./devices.js").DeviceEvent[] }} State
 */

/**
 * @param {{
 *   bridge: { call(method: string, params: any): Promise<any> },
 *   runner: import("./run.js").Runner,
 *   store: import("./store.js").NetworkStore,
 *   oui: () => import("./oui.js").OuiTable,
 *   t: (id: string, params?: Record<string, unknown>) => string,
 *   platform: string,
 *   now?: () => string,
 *   onChange(state: State): void,
 * }} deps
 */
export function createNetwork(deps) {
  const now = deps.now ?? (() => new Date().toISOString());
  /** @type {State} */
  const state = {
    busy: null,
    here: null,
    admin: undefined,
    devices: [],
    refusal: null,
    scanned: null,
    wifi: null,
    wifiRefusal: null,
    swept: false,
    wide: false,
    log: [],
  };
  /** @type {import("./devices.js").Records} */
  let records = {};
  /** @type {Record<string, import("./ports.js").PortResult>} */
  let ports = {};
  /** @type {Set<string>} */
  let online = new Set();
  /** @type {Promise<void> | null} */
  let scanning = null;
  let askedNotify = false;
  const changed = () => deps.onChange(state);
  /** What runs now (a look, a port check, the Wi-Fi), each its own; the newest shows. @type {Map<number, NonNullable<State["busy"]>>} */
  const jobs = new Map();
  let nextJob = 0;
  const showBusy = () => {
    state.busy = [...jobs.values()].at(-1) ?? null;
    changed();
  };
  /** @param {string} phase */
  const startJob = (phase) => {
    const id = ++nextJob;
    jobs.set(id, { phase, done: 0, total: 0 });
    showBusy();
    return {
      /** @param {string} p @param {number} done @param {number} total */
      update: (p, done, total) => {
        jobs.set(id, { phase: p, done, total });
        showBusy();
      },
      end: () => {
        jobs.delete(id);
        showBusy();
      },
    };
  };

  const derive = () => {
    const here = state.here;
    state.devices = devicesOf(records, {
      oui: deps.oui(),
      online,
      gateway: here?.gateway.mac ?? null,
      self: here?.self.mac ?? null,
      ports,
    });
  };

  const guardOs = () => {
    if (deps.platform !== "mac") throw new NetworkRefusal("unsupported-os");
  };

  /** Look at the network now; a look already running is joined, not doubled. */
  const scan = () => {
    scanning ??= (async () => {
      /** @type {ReturnType<typeof startJob> | null} */
      let job = null;
      try {
        guardOs();
        job = startJob("locate");
        const look = await scanNetwork(deps.runner, {
          admin: async (/** @type {string} */ id, /** @type {string} */ cidr) => {
            const networks = await deps.store.networks();
            if (!networks[id]) {
              networks[id] = { cidr, first: now() };
              await deps.store.saveNetworks(networks);
            }
            state.admin = networks[id].admin;
            return state.admin === true;
          },
          now,
          onProgress: (phase, done, total) => job?.update(phase, done, total),
        });
        const id = look.here.id;
        if (state.here?.id !== id) {
          records = await deps.store.devices(id);
          ports = await deps.store.ports(id);
          state.log = await deps.store.log(id);
        }
        state.here = look.here;
        state.swept = look.swept;
        state.wide = look.wide;
        const merged = mergeScan(records, look);
        records = merged.records;
        online = new Set(look.seen.map((s) => s.mac));
        await deps.store.saveDevices(id, records);
        if (merged.events.length > 0)
          state.log = await deps.store.appendLog(id, state.log, merged.events);
        state.scanned = look.at;
        state.refusal = null;
        derive();
        await announce(merged.events);
      } catch (error) {
        if (!isRefusal(error)) throw error;
        state.refusal = error;
      } finally {
        scanning = null;
        if (job) job.end();
        else changed();
      }
    })();
    return scanning;
  };

  /** Tell the person about devices the network has never shown (not on its first look). @param {import("./devices.js").DeviceEvent[]} events */
  const announce = async (events) => {
    const fresh = events.filter((e) => e.kind === "new");
    if (fresh.length === 0) return;
    const named = fresh
      .map((e) => state.devices.find((d) => d.mac === e.mac))
      .filter((d) => d !== undefined)
      .map((d) => cardLabel(deps.t, d));
    const note = {
      title: deps.t("notify.new.title", { count: fresh.length }),
      body: deps.t("notify.new.body", {
        devices: named.slice(0, 3).join(", "),
        count: fresh.length,
      }),
      level: "info",
      scope: { permission: "ui:notify" },
    };
    try {
      await deps.bridge.call("ui.notify", note);
    } catch (error) {
      // The grant is asked for once, the first time a new device is to be said.
      if (/** @type {{ code?: string }} */ (error)?.code !== "permission_denied" || askedNotify)
        return;
      askedNotify = true;
      const asked = await deps.bridge
        .call("perm.request", {
          permission: { permission: "ui:notify" },
          reason: deps.t("notify.reason"),
        })
        .catch(() => ({ granted: false }));
      if (asked.granted) await deps.bridge.call("ui.notify", note).catch(() => {});
    }
  };

  /** The person's answer to "Are you this network's administrator?". @param {boolean} yes */
  const answerAdmin = async (yes) => {
    const id = state.here?.id;
    if (!id) return;
    const networks = await deps.store.networks();
    networks[id] = {
      ...(networks[id] ?? { cidr: state.here?.cidr ?? "", first: now() }),
      admin: yes,
    };
    await deps.store.saveNetworks(networks);
    state.admin = yes;
    changed();
    if (yes) await scan();
  };

  /** @param {string} mac */
  const deviceOf = (mac) => {
    const d = state.devices.find((x) => x.mac === mac.toLowerCase());
    if (!d) throw new NetworkRefusal("unknown-device", { mac });
    return d;
  };

  /** "Who is this?": a name, a kind and whether it is the person's own. @param {string} mac @param {{ name?: string, kind?: string, mine?: boolean }} answer */
  const name = async (mac, answer) => {
    const d = deviceOf(mac);
    const id = /** @type {Here} */ (state.here).id;
    records = { ...records, [d.mac]: nameDevice(records[d.mac], answer) };
    await deps.store.saveDevices(id, records);
    derive();
    changed();
    return /** @type {Device} */ (state.devices.find((x) => x.mac === d.mac));
  };

  const portNetwork = () => {
    guardOs();
    if (state.admin !== true)
      throw new NetworkRefusal(state.admin === false ? "not-admin" : "admin-unasked");
    if (!state.here) throw new NetworkRefusal("no-network");
    return state.here;
  };

  /** @param {Device} d @param {Here} here */
  const recordPorts = async (d, here, allowed = false) => {
    if (state.here?.id !== here.id || state.admin !== true) throw new NetworkRefusal("no-network");
    if (deviceOf(d.mac).ip !== d.ip) throw new NetworkRefusal("unknown-device", { mac: d.mac });
    const result = await checkPorts(deps.bridge, {
      ip: d.ip,
      network: here.network,
      reason: deps.t("ports.reason", { device: cardLabel(deps.t, d), ip: d.ip }),
      allowed,
      now,
    });
    if (state.here?.id !== here.id) throw new NetworkRefusal("no-network");
    ports = { ...ports, [d.mac]: result };
    await deps.store.savePorts(here.id, ports);
    derive();
    return /** @type {Device} */ (state.devices.find((x) => x.mac === d.mac));
  };

  /** Check one known device's ports, after the person's yes to the grant. @param {string} mac */
  const checkDevice = async (mac) => {
    const here = portNetwork();
    const d = deviceOf(mac);
    const job = startJob("ports");
    try {
      return await recordPorts(d, here);
    } finally {
      job.end();
    }
  };

  /** Review the exact current addresses as one request before sending any checks. */
  const checkAllDevices = async () => {
    const here = portNetwork();
    const devices = state.devices.filter((d) => d.online && !d.self && d.open === null);
    if (!devices.length) return [];
    const ips = [...new Set(devices.map(({ ip }) => ip))];
    const job = startJob("ports");
    try {
      await allowPorts(
        deps.bridge,
        ips,
        here.network,
        deps.t("ports.batchReason", { addresses: ips.join(", ") }),
      );
      const results = [];
      for (const [at, device] of devices.entries()) {
        results.push(await recordPorts(device, here, true));
        job.update("ports", at + 1, devices.length);
      }
      return results;
    } finally {
      job.end();
    }
  };

  /** Read the Wi-Fi around; it only listens. */
  const readChannels = async () => {
    /** @type {ReturnType<typeof startJob> | null} */
    let job = null;
    try {
      guardOs();
      job = startJob("wifi");
      const report = await readWifi(deps.runner);
      if (!report.on) throw new NetworkRefusal("wifi-off");
      state.wifi = report;
      state.wifiRefusal = null;
    } catch (error) {
      if (!isRefusal(error)) throw error;
      state.wifiRefusal = error;
    } finally {
      if (job) job.end();
      else changed();
    }
    return state.wifi;
  };

  /** Whether this network is the Wi-Fi this computer is joined to, and its security mode. */
  const wifiFacts = () => {
    const wifi = state.wifi;
    const applies = Boolean(wifi?.current && state.here && wifi.iface === state.here.iface);
    const read = state.wifi !== null || state.wifiRefusal !== null;
    return { security: applies ? (wifi?.current?.security ?? "") : "", applies, read };
  };

  return {
    state,
    scan,
    answerAdmin,
    name,
    checkDevice,
    checkAllDevices,
    readChannels,
    deviceOf,
    checkup: () => checkup(state.devices, wifiFacts(), (d) => cardLabel(deps.t, d)),
    channels: () => (state.wifi ? channelsModel(state.wifi) : []),
    networkId,
  };
}

/** @typedef {ReturnType<typeof createNetwork>} Network */
