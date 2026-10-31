// The DOM for the sheets plugin: the file's name and format, the formula bar, find, the grid with
// its sheet tabs, the details view, the shortcut card, and the status line with the selection's
// count, sum and average. Keys are the plugin's own only where the desk leaves them free (Mod+F,
// Mod+G, Mod+=, Mod+-, Mod+0 and the grid's arrows); every other chord reaches the desk.
import { findAll, MATCH_LIMIT, nextMatch } from "./find.js";
import { createGrid } from "./grid.js";
import { addressOf } from "./model.js";

/**
 * @typedef {import("./sheets.js").Shown} Shown
 * @typedef {import("./grid.js").Place} Place
 * @typedef {import("./find.js").Matches} Matches
 * @typedef {{ sheet: number, places: Map<number, Place> }} Kept
 */

/** "17 bytes", "3.2 KB", "1.5 MB". */
export function sizeOf(/** @type {number} */ bytes) {
  if (bytes < 1024) return `${bytes} byte${bytes === 1 ? "" : "s"}`;
  const units = ["KB", "MB", "GB"];
  let n = bytes / 1024;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit++;
  }
  return `${n.toFixed(1)} ${units[unit]}`;
}

const number = (/** @type {number} */ n) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 10, useGrouping: true });

/** @param {Document} doc */
export function createView(doc) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const [name, detail, formula, address, content] = [
    "book-name",
    "book-detail",
    "formula",
    "cell-address",
    "cell-content",
  ].map(byId);
  const [findForm, findText, findCount, sheetArea, tabs] = [
    "find",
    "find-text",
    "find-count",
    "sheet",
    "tabs",
  ].map(byId);
  const [details, link, status, stats] = ["details", "link", "status", "stats"].map(byId);
  const root = byId("grid");
  const input = /** @type {HTMLInputElement} */ (findText);

  /** @type {Shown | null} */
  let shown = null;
  let current = 0;
  /** What each open file looked like when it was left: the sheet, and per sheet the selection. */
  /** @type {Map<string, Kept>} */
  const kept = new Map();
  /** @type {{ query: string, sheet: unknown, matches: Matches } | undefined} */
  let found;

  const book = () => (shown?.book.kind === "sheets" ? shown.book : undefined);
  const sheet = () => book()?.sheets[current];

  const update = () => {
    const s = sheet();
    const selection = grid.selection();
    if (!s || !selection) return;
    const { r, c } = selection.active();
    address.textContent = addressOf(r, c);
    /** @type {HTMLInputElement} */ (content).value = s.input(r, c);
    const sums = selection.stats();
    stats.textContent = sums
      ? `Count ${number(sums.count)} · Sum ${number(sums.sum)} · Average ${number(sums.average)}`
      : "";
  };
  const grid = createGrid(
    doc,
    {
      root,
      scroller: byId("grid-scroll"),
      sizer: byId("grid-size"),
      layer: byId("grid-layer"),
    },
    { changed: update },
  );

  /** Remember where the person was on the sheet on screen. */
  const keep = () => {
    if (!shown || !book()) return;
    const place = grid.place();
    const entry = kept.get(shown.buffer) ?? { sheet: current, places: new Map() };
    entry.sheet = current;
    if (place) entry.places.set(current, place);
    kept.set(shown.buffer, entry);
  };

  const showSheet = (/** @type {number} */ index, focusTab = false) => {
    const all = book()?.sheets ?? [];
    current = Math.min(Math.max(0, index), all.length - 1);
    const buttons = [...tabs.querySelectorAll('[role="tab"]')];
    buttons.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === current));
      tab.setAttribute("tabindex", i === current ? "0" : "-1");
    });
    if (focusTab) /** @type {HTMLElement | undefined} */ (buttons[current])?.focus();
    const s = all[current];
    if (!s) return;
    grid.show(s, shown ? kept.get(shown.buffer)?.places.get(current) : undefined);
    found = undefined;
    findCount.textContent = "";
  };

  const renderTabs = (/** @type {string[]} */ names) => {
    tabs.replaceChildren(
      ...names.map((label, i) => {
        const tab = doc.createElement("button");
        tab.type = "button";
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", "grid");
        tab.textContent = label;
        tab.addEventListener("click", () => {
          keep();
          showSheet(i);
        });
        return tab;
      }),
    );
    tabs.hidden = names.length === 0;
  };
  tabs.addEventListener("keydown", (event) => {
    const count = book()?.sheets.length ?? 0;
    const to = /** @type {Record<string, number>} */ ({
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      Home: 0,
      End: count - 1,
    })[event.key];
    if (to === undefined || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    keep();
    showSheet((to + count) % count, true);
  });

  /** Find the next (or previous) match of the words in the find field. */
  const next = (back = false) => {
    const s = sheet();
    const selection = grid.selection();
    const query = input.value;
    if (!s || !selection || !query) return;
    if (found?.query !== query || found.sheet !== s) {
      const { rows, cols } = grid.axes();
      found = { query, sheet: s, matches: findAll(s, rows, cols, query) };
    }
    const { matches } = found;
    const { r, c } = selection.active();
    const at = nextMatch(matches, r, c, back);
    if (at < 0) {
      findCount.textContent = "No matches";
      return;
    }
    grid.go(matches.rows[at] ?? 0, matches.cols[at] ?? 0);
    const total = matches.capped ? `${number(MATCH_LIMIT)}+` : number(matches.length);
    findCount.textContent = `${number(at + 1)} of ${total}`;
  };
  const openFind = () => {
    if (!book()) return;
    findForm.hidden = false;
    input.focus();
    input.select();
  };
  const closeFind = () => {
    findForm.hidden = true;
    findCount.textContent = "";
    root.focus();
  };
  findForm.addEventListener("submit", (event) => event.preventDefault());
  input.addEventListener("input", () => {
    found = undefined;
    findCount.textContent = "";
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      next(event.shiftKey);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeFind();
    }
  });
  byId("find-next").addEventListener("click", () => next(false));
  byId("find-previous").addEventListener("click", () => next(true));
  byId("find-close").addEventListener("click", closeFind);

  doc.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || !book()) return;
    const key = event.key.toLowerCase();
    if (key === "f" && !event.shiftKey) openFind();
    else if (key === "g") {
      if (!input.value) openFind();
      else next(event.shiftKey);
    } else if (key === "=" || key === "+" || key === "-" || key === "0") {
      const zoom = grid.zoom(key === "0" ? 0 : key === "-" ? -1 : 1);
      status.textContent = `Zoom ${Math.round(zoom * 100)}%`;
    } else return;
    event.preventDefault();
  });

  return {
    /** @param {Shown | null} model */
    show(model) {
      keep();
      const same = model !== null && shown?.buffer === model.buffer;
      shown = model;
      const kind = model?.book.kind;
      name.textContent = model ? model.name : "No spreadsheet open";
      detail.textContent = model
        ? [model.book.format, model.book.kind === "sheets" ? model.book.detail : ""]
            .filter(Boolean)
            .join(" · ")
        : "";
      formula.hidden = kind !== "sheets";
      sheetArea.hidden = kind !== "sheets";
      details.hidden = kind !== "details";
      link.hidden = kind !== "link";
      if (kind !== "sheets") {
        findForm.hidden = true;
        stats.textContent = "";
        grid.clear();
      }
      if (model?.book.kind === "details") {
        byId("details-reason").textContent = model.book.reason;
        byId("details-name").textContent = model.name;
        byId("details-size").textContent = sizeOf(model.size);
        byId("details-format").textContent =
          `${model.book.detected} (named as ${model.book.format})`;
        byId("details-cause").textContent = model.book.cause ?? "";
      } else if (model?.book.kind === "link") {
        byId("link-url").textContent = model.book.url;
      } else if (model?.book.kind === "sheets") {
        renderTabs(model.book.sheets.map((s) => s.name));
        showSheet(same ? current : (kept.get(model.buffer)?.sheet ?? 0));
      }
    },

    /** @param {string} words */
    status(words) {
      status.textContent = words;
    },

    focus() {
      const kind = shown?.book.kind;
      if (kind === "sheets") root.focus();
      else if (kind === "details") details.focus();
      else if (kind === "link") link.focus();
    },
  };
}
