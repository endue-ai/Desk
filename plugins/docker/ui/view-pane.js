// The detail pane's DOM: its bar (what it is about, its state, the actions that fit), its tabs, the
// panel of the tab on screen with its own cursor, and the logs. The Stats tab and the state follow
// the stats stream; the Files panel marks itself as a drop target (drop.js).

import { el, stateDot } from "./dom.js";
import { createTree } from "./tree.js";
import { renderJson } from "./view-json.js";
import { createLogPane } from "./view-logs.js";
import {
  renderEnv,
  renderFiles,
  renderHistory,
  renderImageInfo,
  renderInfo,
  renderOutput,
  renderPorts,
  renderStats,
} from "./view-panels.js";

/**
 * @typedef {import("./pane.js").PaneModel} PaneModel
 * @typedef {import("./docker.js").StatsRead} StatsRead
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const TAB_TITLES = /** @type {Record<string, string>} */ ({
  info: "Info",
  logs: "Logs",
  stats: "Stats",
  env: "Env",
  ports: "Ports",
  json: "Inspect",
  files: "Files",
  history: "History",
  output: "Output",
});

/** The bar's buttons for each kind of pane: label, action, variant. */
const ACTIONS = /** @type {Record<string, Array<[string, string, string]>>} */ ({
  running: [
    ["Stop", "stop", ""],
    ["Restart", "restart", ""],
    ["Shell", "shell", ""],
    ["Remove", "remove", "danger"],
  ],
  paused: [
    ["Unpause", "togglePause", ""],
    ["Remove", "remove", "danger"],
  ],
  stopped: [
    ["Start", "start", "primary"],
    ["Remove", "remove", "danger"],
  ],
  // Logs opened before the detail was read: the state is not known yet.
  unknown: [
    ["Restart", "restart", ""],
    ["Shell", "shell", ""],
  ],
  image: [
    ["Run", "run", "primary"],
    ["Pull", "pull", ""],
    ["Remove", "removeImage", "danger"],
  ],
  project: [
    ["Restart", "composeRestart", ""],
    ["Open file", "openFile", ""],
  ],
  op: [["Cancel", "cancel", ""]],
});

/**
 * @param {Document} doc
 * @param {Act} act
 */
export function createPaneView(doc, act) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const root = byId("pane");
  const dot = byId("pane-dot");
  const title = byId("pane-title");
  const sub = byId("pane-sub");
  const actions = byId("pane-actions");
  const tabs = byId("pane-tabs");
  const body = byId("pane-body");
  const logsEl = byId("logs");
  const logLines = byId("log-lines");
  const pressed = (/** @type {string} */ id, /** @type {boolean} */ on) =>
    doc.getElementById(id)?.setAttribute("aria-pressed", String(on));
  const logs = createLogPane(doc, {
    head: byId("logs-head"),
    lines: logLines,
    end: byId("logs-end"),
    onState: ({ follow, timestamps }) => {
      pressed("log-follow", follow);
      pressed("log-times", timestamps);
    },
  });
  const tree = createTree(doc, body, {
    activate: (spec) => {
      const item = spec.item;
      if (item?.kind === "entry") void act(item.dir ? "browse" : "copyOut", item.path);
      else if (spec.el.querySelector("a.port")) {
        const link = /** @type {HTMLElement} */ (spec.el.querySelector("a.port"));
        void act("openPortOf", link.dataset.container, link.dataset.port);
      } else if (spec.fold && tree.fold()) draw();
    },
  });
  /** @type {PaneModel | null} */
  let model = null;
  /** @type {StatsRead | undefined} */
  let read;
  /** @type {HTMLElement | undefined} */
  let focusEl;

  const stateOf = () => {
    const state = model?.state ?? "";
    if (model?.kind === "image" || model?.kind === "project" || model?.kind === "op")
      return model.kind;
    if (state === "") return "unknown";
    return state === "running" ? "running" : state === "paused" ? "paused" : "stopped";
  };

  const drawBar = () => {
    if (!model) return;
    const state = model.kind === "op" ? (model.op?.state ?? "running") : model.state;
    dot.replaceChildren(
      model.kind === "container" || model.kind === "op"
        ? stateDot(
            doc,
            state === "done" ? "running" : state === "failed" ? "dead" : state || "created",
            model.detail?.health || null,
          )
        : "",
    );
    title.textContent = model.title;
    title.title = model.title;
    sub.textContent = model.subtitle;
    const buttons =
      model.kind === "op" && model.op?.state !== "running" ? [] : (ACTIONS[stateOf()] ?? []);
    actions.replaceChildren(
      ...buttons.map(([label, action, variant]) =>
        el(
          doc,
          "button",
          { type: "button", class: `desk-btn desk-btn-${variant || "quiet"}`, "data-act": action },
          label,
        ),
      ),
    );
  };

  const drawTabs = () => {
    if (!model) return;
    tabs.replaceChildren(
      ...model.tabs.map((name) => {
        const on = name === model?.tab;
        return el(
          doc,
          "button",
          {
            type: "button",
            role: "tab",
            class: "desk-tab",
            id: `pane-tab-${name}`,
            "aria-selected": on ? "true" : "false",
            "aria-controls": name === "logs" ? "logs" : "pane-body",
            tabindex: on ? "0" : "-1",
            "data-tab": name,
          },
          TAB_TITLES[name] ?? name,
        );
      }),
    );
  };

  /** The panel of the tab on screen. */
  const panel = () => {
    const m = /** @type {PaneModel} */ (model);
    const id = m.item?.kind === "container" ? m.item.id : "";
    switch (m.tab) {
      case "info":
        return m.kind === "image"
          ? renderImageInfo(doc, m.image)
          : renderInfo(doc, m.detail, tree.folded);
      case "env":
        return renderEnv(doc, m.detail);
      case "ports":
        return renderPorts(doc, m.detail);
      case "json":
        return {
          rows: m.detail
            ? renderJson(doc, m.detail.json, tree.folded)
            : renderInfo(doc, null, tree.folded).rows,
        };
      case "files":
        return renderFiles(doc, m.files, id, m.title);
      case "stats":
        return renderStats(doc, read?.(id), m.state);
      case "history":
        return renderHistory(doc, m.image);
      case "output":
        return renderOutput(doc, m.op);
      default:
        return { rows: [] };
    }
  };

  const draw = () => {
    if (!model) return;
    const logsTab = model.tab === "logs";
    logsEl.hidden = !logsTab;
    body.hidden = logsTab;
    if (logsTab) return;
    const drawn = /** @type {{ rows: any[], nodes?: Node[], focus?: HTMLElement }} */ (panel());
    tree.set(drawn.rows, drawn.nodes);
    focusEl = drawn.focus;
    body.setAttribute("aria-label", `${model.title}: ${TAB_TITLES[model.tab] ?? model.tab}`);
    body.setAttribute("aria-labelledby", `pane-tab-${model.tab}`);
    if (drawn.focus) drawn.focus.scrollTop = drawn.focus.scrollHeight;
  };

  tabs.addEventListener("click", (event) => {
    const tab = /** @type {HTMLElement | null} */ (event.target)?.closest?.("[data-tab]");
    if (tab) void act("paneTab", /** @type {HTMLElement} */ (tab).dataset.tab);
  });
  body.addEventListener("click", (event) => {
    const link = /** @type {HTMLElement | null} */ (event.target)?.closest?.("a.port");
    if (link) {
      event.preventDefault();
      void act(
        "openPortOf",
        /** @type {HTMLElement} */ (link).dataset.container,
        /** @type {HTMLElement} */ (link).dataset.port,
      );
      return;
    }
    const spec = tree.hit(event.target);
    if (
      spec?.fold &&
      /** @type {HTMLElement} */ (event.target).classList.contains("caret") &&
      tree.fold()
    )
      draw();
  });
  body.addEventListener("dblclick", (event) => {
    if (tree.hit(event.target)) tree.activate();
  });

  return {
    root,
    body,
    logLines,
    logs,
    tree,
    /** Show what the pane is about, or close it. */
    render(/** @type {PaneModel | null} */ next) {
      const changed = next?.key !== model?.key;
      // A tab or bar button that had the focus is drawn anew: the focus goes to the same place.
      const had = /** @type {HTMLElement | null} */ (doc.activeElement);
      const onTab = had && tabs.contains(had);
      const inPane = had && root.contains(had);
      model = next;
      root.hidden = !next;
      if (!next) return;
      if (changed) tree.folded.clear();
      drawBar();
      drawTabs();
      draw();
      if (onTab)
        /** @type {HTMLElement | null} */ (tabs.querySelector('[aria-selected="true"]'))?.focus();
      else if (inPane && !root.contains(doc.activeElement)) this.focus();
    },
    /** New resource use: the Stats tab and the state follow it. */
    stats(/** @type {StatsRead} */ next) {
      read = next;
      if (model?.tab === "stats") draw();
    },
    draw,
    model: () => model,
    /** The tab before or after the one on screen. */
    neighbour(/** @type {number} */ step) {
      if (!model) return undefined;
      const at = model.tabs.indexOf(model.tab);
      return model.tabs[(at + step + model.tabs.length) % model.tabs.length];
    },
    focus() {
      if (!model) return;
      if (model.tab === "logs") logLines.focus();
      else if (focusEl) focusEl.focus();
      else tree.focus();
    },
    contains: (/** @type {Node | null} */ node) => !!node && root.contains(node),
    /** The Files panel's folder up one. */
    up() {
      const files = model?.files;
      if (model?.tab === "files" && files && files.path !== "/")
        void act("browse", files.path.slice(0, files.path.lastIndexOf("/")) || "/");
    },
  };
}
