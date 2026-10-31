// The DOM of the Docker surface: the header (context, engine, live dot, what is wrong), tabs for
// the six lists, one tree of rows for the list or detail on screen with a cursor the arrow keys
// move and folding, the logs pane, single-letter keys, a hint line and a status live region. Chords
// with Mod are never prevented, so the desk's keymap gets them.

import { actionFor, LISTS, pressOf } from "./keys.js";
import {
  renderCompose,
  renderContainers,
  renderDetail,
  renderImages,
  renderNetworks,
  renderSystem,
  renderVolumes,
} from "./view-lists.js";
import { createLogPane } from "./view-logs.js";

/**
 * @typedef {import("./docker.js").View} View
 * @typedef {import("./docker.js").ListName} ListName
 * @typedef {import("./keys.js").ViewName} ViewName
 * @typedef {import("./dom.js").RowSpec} RowSpec
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const MOVES = new Set(["next", "previous", "first", "last"]);
const TITLES = {
  containers: "Containers",
  compose: "Compose",
  images: "Images",
  volumes: "Volumes",
  networks: "Networks",
  system: "Engine",
};

/**
 * @param {Document} doc
 * @param {Act} act Runs one of the controller's actions by name.
 * @returns {View}
 */
export function createView(doc, act) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const contextEl = byId("context");
  const engineEl = byId("engine");
  const liveEl = byId("live");
  const busyEl = byId("busy");
  const problemEl = byId("problem");
  const tabs = byId("tabs");
  const tree = byId("view");
  const logsEl = byId("logs");
  const logLines = byId("log-lines");
  const hintsEl = byId("hints");
  const statusEl = byId("status");
  const pane = createLogPane(doc, {
    head: byId("logs-head"),
    lines: logLines,
    end: byId("logs-end"),
  });

  /** @type {ViewName} */
  let current = "containers";
  /** @type {Record<string, unknown>} */
  const models = {};
  /** @type {RowSpec[]} */
  let rows = [];
  let cursor = 0;
  /** What the cursor was on, so a re-render keeps it there. */
  let cursorKey = "";
  const folded = new Set();

  for (const [index, name] of LISTS.entries()) {
    const button = doc.createElement("button");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.id = `tab-${name}`;
    button.textContent = `${index + 1} ${TITLES[name]}`;
    button.tabIndex = -1;
    button.addEventListener("click", () => void act(name));
    tabs.append(button);
  }

  const keyOf = (/** @type {RowSpec | undefined} */ spec) =>
    spec?.fold ?? (spec?.item ? JSON.stringify(spec.item) : "");

  /** The rows of what is on screen. */
  const build = () => {
    const model = /** @type {any} */ (models[current]);
    if (!model) return [];
    if (current === "containers") return renderContainers(doc, model, folded);
    if (current === "compose") return renderCompose(doc, model, folded);
    if (current === "images") return renderImages(doc, model);
    if (current === "volumes") return renderVolumes(doc, model);
    if (current === "networks") return renderNetworks(doc, model);
    if (current === "system") return renderSystem(doc, model, folded);
    if (current === "inspect") return renderDetail(doc, model, folded);
    return [];
  };

  const render = () => {
    rows = build();
    const found = rows.findIndex((spec) => keyOf(spec) === cursorKey && cursorKey !== "");
    cursor = found >= 0 ? found : Math.min(cursor, Math.max(0, rows.length - 1));
    const focused = tree.contains(doc.activeElement);
    rows.forEach((spec, index) => {
      spec.el.setAttribute("role", "treeitem");
      spec.el.setAttribute("aria-level", String(spec.level));
      if (spec.fold) spec.el.setAttribute("aria-expanded", String(!folded.has(spec.fold)));
      spec.el.dataset.index = String(index);
      spec.el.tabIndex = index === cursor ? 0 : -1;
      spec.el.setAttribute("aria-selected", String(index === cursor));
    });
    tree.replaceChildren(...rows.map((spec) => spec.el));
    const detail = /** @type {{ name?: string } | undefined} */ (models.inspect);
    tree.setAttribute(
      "aria-label",
      current === "inspect" ? `Container ${detail?.name ?? ""}` : `Docker ${current}`,
    );
    if (focused) rows[cursor]?.el.focus();
  };

  const moveTo = (/** @type {number} */ index) => {
    if (rows.length === 0) return;
    const next = Math.max(0, Math.min(rows.length - 1, index));
    rows[cursor]?.el.setAttribute("aria-selected", "false");
    if (rows[cursor]) rows[cursor].el.tabIndex = -1;
    cursor = next;
    const spec = rows[cursor];
    if (!spec) return;
    cursorKey = keyOf(spec);
    spec.el.tabIndex = 0;
    spec.el.setAttribute("aria-selected", "true");
    spec.el.focus();
    spec.el.scrollIntoView({ block: "nearest" });
  };

  const move = (/** @type {string} */ action) => {
    if (action === "next") moveTo(cursor + 1);
    else if (action === "previous") moveTo(cursor - 1);
    else if (action === "first") moveTo(0);
    else moveTo(rows.length - 1);
  };

  /** Fold the row under the cursor, or the section it belongs to. */
  const fold = () => {
    let at = cursor;
    while (at >= 0 && !rows[at]?.fold) at--;
    const key = rows[at]?.fold;
    if (!key) return;
    if (folded.has(key)) folded.delete(key);
    else folded.add(key);
    cursorKey = key;
    render();
    moveTo(rows.findIndex((spec) => spec.fold === key));
  };

  const onKey = (/** @type {KeyboardEvent} */ event) => {
    const action = actionFor(current, pressOf(event));
    if (!action) return;
    event.preventDefault();
    if (MOVES.has(action)) move(action);
    else if (action === "fold") fold();
    else if (action === "end") pane.end();
    else if (action === "top") pane.top();
    else void act(action);
  };
  tree.addEventListener("keydown", onKey);
  logLines.addEventListener("keydown", onKey);
  tree.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement | null} */ (event.target);
    const rowEl = target?.closest("[role=treeitem]");
    const index = Number(/** @type {HTMLElement | null} */ (rowEl)?.dataset.index);
    if (Number.isNaN(index)) return;
    moveTo(index);
    if (rows[index]?.fold && target?.classList.contains("caret")) fold();
  });
  tree.addEventListener("dblclick", () => {
    const item = rows[cursor]?.item;
    if (item?.kind === "container") void act("inspect");
    else if (item?.kind === "project") void act("logs");
  });

  return {
    header(header) {
      contextEl.textContent = header.context ? `context ${header.context}` : "";
      engineEl.textContent = header.engine;
      liveEl.hidden = !header.live;
      problemEl.textContent = header.problem;
      problemEl.hidden = header.problem === "";
    },
    show(name, hints) {
      current = name;
      hintsEl.textContent = hints;
      const logs = name === "logs";
      logsEl.hidden = !logs;
      tree.hidden = logs;
      for (const button of tabs.querySelectorAll("button"))
        button.setAttribute("aria-selected", String(button.id === `tab-${name}`));
      if (!logs) render();
    },
    list(name, model) {
      models[name] = model;
      if (current === name) render();
    },
    logs(model) {
      pane.render(model);
    },
    detail(model) {
      if (model) models.inspect = model;
      else delete models.inspect;
      if (current === "inspect") render();
    },
    say(text) {
      statusEl.textContent = text;
    },
    busy(running) {
      busyEl.hidden = running === 0;
    },
    focus() {
      if (current === "logs") logLines.focus();
      else if (rows[cursor]) rows[cursor]?.el.focus();
      else tree.focus();
    },
    selection() {
      return current === "logs" ? undefined : rows[cursor]?.item;
    },
  };
}
