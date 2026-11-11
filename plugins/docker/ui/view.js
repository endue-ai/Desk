// The DOM of the Docker surface: the header (engine, context, live dot, what is wrong with a way to
// try again), tabs for the six lists, the toolbar (search, chips, sort, marks), the list with its
// cursor, the detail pane beside it, the keys panel, a hint line and a status live region. Keys go
// to where the focus is (the list or the pane); chords with Mod are never prevented, so the desk's
// keymap gets them, and Tab is left to move between the list and the pane.

import { el } from "./dom.js";
import { actionFor, hints, LISTS, pressOf, VIEW_ONLY } from "./keys.js";
import { fillMetrics } from "./sparkline.js";
import { createTree } from "./tree.js";
import { createKeysCard } from "./view-keys.js";
import {
  renderCompose,
  renderContainers,
  renderImages,
  renderNetworks,
  renderVolumes,
} from "./view-lists.js";
import { COUNTED, emptyRow, TITLES } from "./view-names.js";
import { renderOverview } from "./view-overview.js";
import { createPaneView } from "./view-pane.js";
import { createToolbar } from "./view-toolbar.js";

/**
 * @typedef {import("./docker.js").View} View
 * @typedef {import("./docker.js").ListName} ListName
 * @typedef {import("./docker.js").StatsRead} StatsRead
 * @typedef {import("./keys.js").ViewName} ViewName
 * @typedef {import("./view-lists.js").Spec} Spec
 * @typedef {import("./query.js").Prefs} Prefs
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const MOVES = new Set(["next", "previous", "first", "last", "pageDown", "pageUp"]);
/** Lists re-sorted as resource use changes, at most this often. */
const RESORT_MS = 2000;

/**
 * @param {Document} doc
 * @param {Act} act Runs one of the controller's actions by name.
 * @returns {View}
 */
export function createView(doc, act) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const engineEl = byId("engine");
  const engineDot = byId("engine-dot");
  const contextEl = byId("context");
  const liveEl = byId("live");
  const busyEl = byId("busy");
  const problemEl = byId("problem");
  const problemText = byId("problem-text");
  const tabs = byId("tabs");
  const split = byId("split");
  const listEl = byId("view");
  const hintsEl = byId("hints");
  const statusEl = byId("status");
  const logSearch = /** @type {HTMLInputElement} */ (byId("log-search"));
  const toolbar = createToolbar(doc, act);
  const pane = createPaneView(doc, act);
  const list = createTree(doc, listEl, {
    activate: (spec) => activate(spec),
    changed: () => toolbar.marked(list.marked().length),
  });

  /** @type {ViewName} */
  let current = "overview";
  /** @type {ListName} */
  let shownList = "overview";
  /** @type {Record<string, unknown>} */
  const models = {};
  /** The lists whose first read failed. @type {Set<string>} */
  const unread = new Set();
  /** @type {Record<string, Prefs>} */
  const prefs = {};
  /** @type {StatsRead | undefined} */
  let read;
  let sortedAt = 0;
  let wrap = true;
  let problem = "";

  for (const [index, name] of LISTS.entries()) {
    const button = el(
      doc,
      "button",
      {
        type: "button",
        class: "desk-tab",
        role: "tab",
        id: `tab-${name}`,
        "aria-controls": "view",
        tabindex: "-1",
      },
      `${index + 1} ${TITLES[name]}`,
    );
    button.addEventListener("click", () => void act(name));
    tabs.append(button);
  }

  /** Enter on a row: the overview's lines lead somewhere, a project opens its logs. */
  const activate = (/** @type {Spec} */ spec) => {
    const item = spec.item;
    if (item?.kind === "goto")
      void (item.list.startsWith("@")
        ? act(item.list.slice(1))
        : act("goto", item.list, item.query));
    else if (item?.kind === "container") void act("inspect");
    else if (item?.kind === "project") void act("logs");
    else if (item?.kind === "image") void act("openImage");
    else if (spec.fold && list.fold()) render();
  };

  /** Fill the metric cells of the rows on screen from the stats stream. */
  const patch = () => {
    if (!read) return;
    for (const spec of /** @type {Spec[]} */ (list.rows()))
      if (spec.metrics) fillMetrics(doc, spec.metrics, read(spec.metrics.id));
  };

  /** Draw the list on screen. */
  const render = () => {
    const model = /** @type {any} */ (models[shownList]);
    const p = prefs[shownList] ?? { query: "", sort: { key: "name", desc: false } };
    if (!model) {
      // Not "Reading…" for ever: a read that failed says so.
      const row = emptyRow(doc, shownList, unread.has(shownList), problem !== "");
      list.set([{ el: row, item: undefined, level: 1 }]);
      return;
    }
    const drawn =
      shownList === "overview"
        ? renderOverview(doc, model, read)
        : shownList === "containers"
          ? renderContainers(doc, model, p, list.folded, read?.latest())
          : shownList === "compose"
            ? renderCompose(doc, model, p, list.folded)
            : shownList === "images"
              ? renderImages(doc, model, p)
              : shownList === "volumes"
                ? renderVolumes(doc, model, p)
                : renderNetworks(doc, model, p);
    list.set(drawn.rows, drawn.nodes);
    listEl.setAttribute("aria-label", `Docker ${TITLES[shownList].toLowerCase()}`);
    listEl.setAttribute("aria-multiselectable", String(shownList !== "overview"));
    const kind = COUNTED[shownList];
    const total = /** @type {any[]} */ (model[`${kind}s`] ?? []).length;
    if (kind) toolbar.counted(drawn.rows.filter((r) => r.item?.kind === kind).length, total);
    toolbar.marked(list.marked().length);
    patch();
  };

  /** Where a key or a focus is: the pane (on its tab) or the list. */
  const placeOf = (/** @type {EventTarget | null} */ target) =>
    pane.contains(/** @type {Node | null} */ (target))
      ? pane.model()?.tab === "logs"
        ? "logs"
        : "inspect"
      : shownList;

  const keysCard = createKeysCard(doc, {
    card: byId("keys"),
    button: byId("keys-btn"),
    title: (where) =>
      where === "inspect" || where === "logs"
        ? "the pane"
        : TITLES[/** @type {ListName} */ (where)],
  });
  const showHints = (/** @type {ViewName} */ where) => {
    hintsEl.textContent = hints(where);
    keysCard.follow(where);
  };

  const toggleWrap = () => {
    wrap = !wrap;
    pane.logs.wrap(wrap);
  };

  /** The keys that only move or mark in the view. @param {ViewName} where @param {string} action */
  const local = (where, action) => {
    const inPane = where === "inspect" || where === "logs";
    const tree = inPane ? pane.tree : list;
    if (MOVES.has(action)) tree.move(action);
    else if (action === "collapse" || action === "expand") {
      if (tree.fold(action === "expand")) inPane ? pane.draw() : render();
    } else if (action === "activate") tree.activate();
    else if (action === "mark") list.mark();
    else if (action === "markAll") list.markAll();
    else if (action === "search") (inPane ? logSearch : toolbar.search).focus();
    else if (action === "end") pane.logs.end();
    else if (action === "top") pane.logs.top();
    else if (action === "toggleWrap") toggleWrap();
    else if (action === "prevTab" || action === "nextTab")
      void act("paneTab", pane.neighbour(action === "prevTab" ? -1 : 1));
    else if (action === "up") pane.up();
    else if (action === "escape") {
      if (inPane) list.focus();
      else if (list.clearMarks()) return;
      else if ((prefs[shownList]?.query ?? "") !== "") void act("query", "");
      else if (pane.model()) void act("closePane");
    }
  };

  const onKey = (/** @type {KeyboardEvent} */ event) => {
    if (keysCard.escape(event)) return;
    const target = /** @type {HTMLElement} */ (event.target);
    if (target === toolbar.search || target === logSearch) {
      if (event.key === "Escape" || event.key === "Enter" || event.key === "ArrowDown") {
        event.preventDefault();
        const field = /** @type {HTMLInputElement} */ (target);
        if (event.key === "Escape" && field.value !== "") {
          field.value = "";
          void act(field === logSearch ? "setFilter" : "query", "");
        }
        if (field === logSearch) pane.logLines.focus();
        else list.focus();
      }
      return;
    }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    if (target.tagName === "BUTTON" && (event.key === "Enter" || event.key === " ")) return;
    const where = placeOf(target);
    const action = actionFor(where, pressOf(event));
    if (!action) return;
    event.preventDefault();
    if (action === "help") keysCard.toggle(where);
    else if (where === "inspect" && action === "copyOut") {
      const item = pane.tree.selection();
      void act("copyOut", item?.kind === "entry" ? item.path : undefined);
    } else if (VIEW_ONLY.has(action)) local(where, action);
    else void act(action);
  };
  split.addEventListener("keydown", onKey);
  logSearch.addEventListener("input", () => void act("setFilter", logSearch.value));
  split.addEventListener("focusin", (event) => {
    const where = placeOf(event.target);
    void act("focused", where === "inspect" || where === "logs" ? "pane" : "list");
    showHints(where);
  });
  listEl.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const link = target.closest?.("a.port");
    if (link) {
      event.preventDefault();
      void act(
        "openPortOf",
        /** @type {HTMLElement} */ (link).dataset.container,
        /** @type {HTMLElement} */ (link).dataset.port,
      );
      return;
    }
    const sort = /** @type {HTMLElement | null} */ (target.closest?.("[data-sort]"));
    if (sort) {
      const key = sort.dataset.sort ?? "name";
      const now = prefs[shownList]?.sort;
      void act("sort", key, now?.key === key ? !now.desc : false);
      return;
    }
    const spec = list.hit(target);
    if (spec?.fold && target.classList.contains("caret") && list.fold()) render();
    else if (spec?.item?.kind === "goto") activate(spec);
  });
  listEl.addEventListener("dblclick", (event) => {
    if (list.hit(event.target)) list.activate();
  });
  // Every button that names an action: Try again, the pane's bar, the marks bar, the logs' toggles.
  doc.addEventListener("click", (event) => {
    const button = /** @type {HTMLElement | null} */ (
      /** @type {HTMLElement} */ (event.target).closest?.("button[data-act]")
    );
    if (!button) return;
    const action = button.dataset.act ?? "";
    // WebKit does not focus a clicked button: say where it is, so the pane's Stop stops the pane's
    // container and the marks bar's acts on the marks.
    if (split.contains(button)) void act("focused", pane.contains(button) ? "pane" : "list");
    if (action === "clearMarks") list.clearMarks();
    else if (action === "toggleWrap") toggleWrap();
    else void act(action);
    // The marks bar goes once its action is done: the keys go back to the list.
    if (byId("marks").contains(button)) list.focus();
  });
  byId("keys-btn").addEventListener("click", () => keysCard.toggle(current));

  return {
    header(header) {
      contextEl.textContent = header.context;
      contextEl.hidden = header.context === "";
      engineEl.textContent = header.engine || (header.problem ? "Docker is not reachable" : "");
      engineDot.className = `dot ${header.problem ? "state-dead" : header.engine ? "state-running" : "state-created"}`;
      engineDot.setAttribute(
        "aria-label",
        header.problem ? "not reachable" : header.engine ? "running" : "checking",
      );
      liveEl.hidden = !header.live;
      problemText.textContent = header.problem;
      const changed = header.problem !== problem;
      problem = header.problem;
      // The overview says it in its engine card, with Try again; the other lists in the banner.
      problemEl.hidden = problem === "" || shownList === "overview";
      const overview = /** @type {any} */ (models.overview);
      if (changed && overview) {
        const up = problem === "" && overview.engine.version !== "";
        models.overview = { ...overview, engine: { ...overview.engine, problem, up } };
      }
      // The engine is back: what could not be read is being read again.
      if (changed && problem === "") unread.clear();
      // The overview's card, or a list that could not be read, says it too.
      if (changed && (shownList === "overview" || !models[shownList])) render();
    },
    show(name, hint) {
      current = name;
      const inPane = name === "logs" || name === "inspect";
      if (!inPane) shownList = /** @type {ListName} */ (name);
      for (const button of tabs.querySelectorAll("button")) {
        const on = button.id === `tab-${shownList}`;
        button.setAttribute("aria-selected", String(on));
        /** @type {HTMLElement} */ (button).tabIndex = on ? 0 : -1;
      }
      toolbar.show(shownList, prefs[shownList]);
      problemEl.hidden = problem === "" || shownList === "overview";
      hintsEl.textContent = hint;
      if (!inPane) render();
      else pane.draw();
    },
    list(name, model) {
      models[name] = model;
      unread.delete(name);
      if (shownList === name) render();
    },
    unread(name) {
      unread.add(name);
      if (shownList === name && !models[name]) render();
    },
    logs(model) {
      pane.logs.render(model);
    },
    detail() {},
    pane(model) {
      pane.render(model);
      split.classList.toggle("with-pane", !!model);
      if (!model && pane.contains(doc.activeElement)) list.focus();
    },
    stats(next) {
      read = next;
      pane.stats(next);
      const key = prefs[shownList]?.sort.key;
      const resort =
        shownList === "overview" ||
        (shownList === "containers" && (key === "cpu" || key === "memory"));
      if (resort && Date.now() - sortedAt > RESORT_MS) {
        sortedAt = Date.now();
        render();
      } else patch();
    },
    prefs(name, value) {
      prefs[name] = value;
      if (shownList === name) {
        toolbar.show(name, value);
        render();
      }
    },
    say(text) {
      statusEl.textContent = text;
    },
    busy(running) {
      busyEl.hidden = running === 0;
    },
    focus() {
      if (current === "logs" || current === "inspect") pane.focus();
      else list.focus();
    },
    selection: () => list.selection(),
    marked: () => list.marked(),
    setMarks: (items) => list.setMarks(items),
  };
}
