// The page's state between the controller and the view: the tab, the device on show, the "Who is
// this?" form, what "Explain simply" said, and the look every few minutes while the plugin is on
// (endue.network.interval, 5 by default, 0 off; NET-17).
import { cardLabel, stepsFor } from "./checkup.js";
import { timeText } from "./dom.js";
import { checkupPayload, createExplainer, devicePayload } from "./explain.js";
import { timelineData } from "./journal.js";
import { pingText, vendorText } from "./labels.js";
import { createNetwork } from "./network.js";
import { portInfo } from "./ports.js";
import { isRefusal, refusalText } from "./refusal.js";
import { TABS } from "./view.js";
import { renderChannels } from "./view-channels.js";
import { renderCheckup } from "./view-checkup.js";
import { renderDevice } from "./view-device.js";
import { createLogView } from "./view-log.js";
import { renderMap } from "./view-map.js";

/**
 * @typedef {import("./view.js").Tab} Tab
 * @typedef {import("./view-device.js").Said} Said
 * @typedef {(id: string, params?: Record<string, unknown>) => string} T
 */

export const INTERVAL_KEY = "endue.network.interval";
export const DEFAULT_INTERVAL = 5;

/** Minutes between looks from the setting's value: 0 to 1440, else the default. @param {unknown} value */
export function intervalOf(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1440
    ? value
    : DEFAULT_INTERVAL;
}

/**
 * @param {{
 *   bridge: any, runner: import("./run.js").Runner, store: import("./store.js").NetworkStore,
 *   oui: () => import("./oui.js").OuiTable, t: T, language: () => string, platform: string,
 *   view: import("./view.js").View, universal?: import("./view-log.js").Universal,
 *   interval?: () => Promise<number>,
 *   timers?: { set(fn: () => void, ms: number): ReturnType<typeof setTimeout>, clear(id: ReturnType<typeof setTimeout>): void },
 * }} deps
 */
export function createApp(deps) {
  const { t, view } = deps;
  // Called as plain functions: a browser refuses setTimeout called as another object's method.
  const timers = deps.timers ?? {
    set: (/** @type {() => void} */ fn, /** @type {number} */ ms) => setTimeout(fn, ms),
    clear: (/** @type {ReturnType<typeof setTimeout>} */ id) => clearTimeout(id),
  };
  /** @type {{ tab: Tab, selected: string | null, who: boolean, said: Map<string, Said> }} */
  const ui = { tab: "map", selected: null, who: false, said: new Map() };
  const log = createLogView(deps.universal);
  const explainer = createExplainer(deps.bridge);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let minutes = DEFAULT_INTERVAL;

  const net = createNetwork({
    bridge: deps.bridge,
    runner: deps.runner,
    store: deps.store,
    oui: deps.oui,
    t,
    platform: deps.platform,
    onChange: () => render(),
  });
  const { state } = net;

  const busyText = () => {
    const b = state.busy;
    return b ? t(`busy.${b.phase}`, { done: b.done, total: b.total }) : null;
  };

  function render() {
    const here = state.here;
    view.here(
      here
        ? t("here.summary", { cidr: here.cidr, gateway: here.gateway.ip, iface: here.iface })
        : t("here.none"),
    );
    view.busy(busyText(), state.busy);
    view.problem(state.refusal ? refusalText(t, state.refusal) : null);
    view.ask(
      {
        state: !here ? null : state.admin === undefined ? "ask" : state.admin ? null : "declined",
        cidr: here?.cidr ?? "",
      },
      t,
    );
    const online = state.devices.filter((d) => d.online).length;
    const notes = [
      state.scanned
        ? t("status.scanned", { time: timeText(state.scanned, deps.language()), count: online })
        : "",
      state.wide ? t("status.wide") : "",
      here && state.admin === false ? t("status.notAdmin") : "",
      minutes > 0 ? t("status.every", { minutes }) : t("status.off"),
    ];
    view.status(notes.filter(Boolean).join(" "));
    view.showTab(ui.tab);
    const canCheck = state.admin === true;
    const device = ui.selected ? (state.devices.find((d) => d.mac === ui.selected) ?? null) : null;
    renderDevice(view.device(), t, {
      device,
      who: ui.who,
      said: device ? ui.said.get(`device:${device.mac}`) : undefined,
      language: deps.language(),
      canCheck,
    });
    const panel = view.panel(ui.tab);
    if (ui.tab === "map")
      renderMap(panel, t, {
        devices: state.devices,
        selected: ui.selected,
        cidr: here?.cidr ?? null,
      });
    if (ui.tab === "checkup")
      renderCheckup(panel, t, {
        checkup: net.checkup(),
        devices: state.devices,
        said: ui.said,
        canCheck,
      });
    if (ui.tab === "channels")
      renderChannels(panel, t, {
        report: state.wifi,
        bands: net.channels(),
        refusal: state.wifiRefusal ? refusalText(t, state.wifiRefusal) : null,
      });
    if (ui.tab === "log")
      log.render(
        panel,
        t,
        timelineData(state.log, new Map(state.devices.map((d) => [d.mac, d])), t),
        deps.language(),
      );
  }

  /** Say a refusal on the status line; anything else is a bug and goes on. @param {unknown} error */
  const said = (error) => {
    if (isRefusal(error)) {
      const { text, todo } = refusalText(t, error);
      view.status(`${text} ${todo}`);
      return;
    }
    throw error;
  };

  const schedule = () => {
    if (timer !== undefined) timers.clear(timer);
    timer = undefined;
    if (minutes > 0) timer = timers.set(() => void net.scan().finally(schedule), minutes * 60_000);
  };

  /** Explain a device or a card, with the brain or with the fixed sentences. @param {string} key @param {unknown} payload @param {() => { summary: string, steps: string[] }} fixed */
  const explain = async (key, payload, fixed) => {
    ui.said.set(key, { state: "working" });
    render();
    const answer = await explainer.explain(payload, deps.language(), t("explain.reason"));
    ui.said.set(
      key,
      answer
        ? { state: "done", ...answer, fixed: false }
        : { state: "done", ...fixed(), fixed: true },
    );
    render();
  };

  /** @param {import("./devices.js").Device} d */
  const fixedDevice = (d) => ({
    summary: t("explain.device", {
      device: cardLabel(t, d),
      kind: t(`kind.${d.kind}`),
      vendor: vendorText(t, d),
      ping: pingText(t, d),
      ports: d.open?.length
        ? t("explain.devicePorts", {
            ports: d.open.map((p) => `${p} ${portInfo(p).service}`.trim()).join(", "),
          })
        : "",
    }),
    steps: [...new Set(d.risky.map(stepsFor))].map((id) => t(id)),
  });

  /** @type {Record<string, (detail: Record<string, any>) => unknown>} */
  const actions = {
    scan: () => net.scan(),
    tab: ({ tab }) => {
      if (TABS.includes(tab)) ui.tab = tab;
      render();
      if (ui.tab === "channels" && !state.wifi && !state.wifiRefusal && !state.busy)
        void net.readChannels();
    },
    listen: () => net.readChannels(),
    device: ({ mac }) => {
      ui.selected = ui.selected === mac && ui.tab === "map" ? null : mac;
      ui.who = false;
      if (ui.selected && ui.tab !== "map") ui.tab = "map";
      render();
    },
    "close-device": () => {
      ui.selected = null;
      render();
    },
    who: () => {
      ui.who = !ui.who;
      render();
    },
    "who-cancel": () => {
      ui.who = false;
      render();
    },
    "who-save": async ({ mac, name, kind, mine }) => {
      await net.name(mac, { name, kind, mine });
      ui.who = false;
      render();
    },
    check: ({ mac }) => net.checkDevice(mac),
    "check-all": () => net.checkAllDevices(),
    "admin-yes": () => net.answerAdmin(true),
    "admin-no": () => net.answerAdmin(false),
    "explain-device": ({ mac }) => {
      const d = net.deviceOf(mac);
      return explain(`device:${d.mac}`, { device: devicePayload(d) }, () => fixedDevice(d));
    },
    "explain-card": ({ card }) => {
      const c = net.checkup();
      const found = c.cards.find((x) => x.id === card);
      if (!found) return;
      const payload = {
        finding: { kind: found.kind, points: found.points, port: found.port ?? null },
        ...checkupPayload({ ...c, cards: [found] }, state.devices),
      };
      return explain(`card:${found.id}`, payload, () => ({
        summary: t(found.key, found.params),
        steps: [t(found.steps)],
      }));
    },
  };

  /** @param {string} name @param {Record<string, unknown>} detail */
  const act = async (name, detail) => {
    try {
      await actions[name]?.(detail);
    } catch (error) {
      said(error);
    }
  };

  const start = async () => {
    minutes = intervalOf(await (deps.interval?.() ?? Promise.resolve(DEFAULT_INTERVAL)));
    render();
    await net.scan();
    schedule();
    // The checkup counts my Wi-Fi's security mode: the report is read once (it only listens).
    if (!state.refusal) await net.readChannels();
  };

  /** A new interval from the settings. @param {unknown} value */
  const setInterval = (value) => {
    minutes = intervalOf(value);
    schedule();
    render();
  };

  return {
    net,
    ui,
    act,
    render,
    start,
    setInterval,
    stop: () => timer !== undefined && timers.clear(timer),
  };
}

/** @typedef {ReturnType<typeof createApp>} App */
