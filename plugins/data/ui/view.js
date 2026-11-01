// The DOM of the data plugin: the file's name and format, the tree and the raw view side by side or
// one at a time, search (Mod+F, Mod+G), the selected node's pointer and path, the reveal button for
// one masked value, the problems panel, a details view for files it cannot show, and a status live
// region. Each open file keeps which nodes are open; a revealed value is masked again on every show.
// The desk's chords (Mod+S, Mod+O, Mod+W, Mod+K) are never prevented.

import { createPanel } from "./panel.js";
import { createPanes } from "./panes.js";
import { CHECKED } from "./schemas.js";
import { chainOf, search } from "./search.js";
import { isMasked, maskRanges } from "./secrets.js";
import { childrenOf, isBranch, pathOf, pointerOf, previewOf, resolve } from "./tree.js";
import { MASK } from "./tree-view.js";

/**
 * @typedef {import("./data.js").Shown} Shown
 * @typedef {import("./data.js").SchemaState} SchemaState
 * @typedef {import("./tree-view.js").Row} Row
 * @typedef {import("./tree-view.js").TreeState} TreeState
 * @typedef {{ validateWith(): unknown, cancel?(): unknown }} Actions
 * @typedef {"tree" | "raw" | "both"} Mode
 */

/** @param {number} n */
const sizeText = (n) => {
  const bytes = `${n.toLocaleString("en-US")} ${n === 1 ? "byte" : "bytes"}`;
  if (n < 1024) return bytes;
  const units = ["KB", "MB", "GB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]} (${bytes})`;
};

/**
 * @param {Document} doc
 * @param {Actions} actions
 */
export function createView(doc, actions) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const $ = {
    name: byId("name"),
    path: byId("path"),
    format: byId("format"),
    note: byId("note"),
    panes: byId("panes"),
    treePane: byId("tree-pane"),
    rawPane: byId("raw-pane"),
    tree: byId("tree"),
    raw: byId("raw"),
    details: byId("details"),
    where: byId("where"),
    pointer: byId("pointer"),
    dotted: byId("dotted"),
    reveal: /** @type {HTMLButtonElement} */ (byId("reveal")),
    search: /** @type {HTMLInputElement} */ (byId("search")),
    count: byId("search-count"),
    status: byId("status"),
    toolbar: byId("toolbar"),
    validate: byId("validate"),
  };
  /** @type {Record<Mode, HTMLElement>} */
  const modes = { tree: byId("mode-tree"), raw: byId("mode-raw"), both: byId("mode-both") };

  /** @type {Shown | null} */
  let model = null;
  let maskKeys = true;
  /** The one revealed row's key. @type {string | null} */
  let revealed = null;
  /** Per buffer: which nodes are open and which is selected, and the mode. */
  /** @type {Map<string, TreeState & { mode: Mode }>} */
  const states = new Map();
  /** @type {{ query: string, matches: import("./search.js").Match[], more: boolean, at: number }} */
  let found = { query: "", matches: [], more: false, at: -1 };

  const say = (/** @type {string} */ text) => {
    $.status.textContent = text;
  };
  const failure = (error) => {
    if (error.name !== "AbortError") say(error.message);
  };
  const safely = (action) => {
    try {
      return Promise.resolve(action()).catch(failure);
    } catch (error) {
      failure(error);
    }
  };
  const docOf = () => model?.opened.doc;

  /** The raw view's dots: every masked range, but the revealed node's. */
  const hiddenRanges = () => {
    const data = docOf();
    if (!data) return [];
    const ranges = maskRanges(data, maskKeys);
    const row = revealed === null ? undefined : tree.selected();
    const node = row?.key === revealed ? row?.chain?.at(-1) : undefined;
    if (!node || node.from === undefined || node.to === undefined) return ranges;
    const [from, to] = [node.from, node.to];
    /** @type {Array<[number, number]>} */
    const out = [];
    for (const [a, b] of ranges) {
      if (b <= from || a >= to) out.push([a, b]);
      else {
        if (a < from) out.push([a, from]);
        if (b > to) out.push([to, b]);
      }
    }
    return out;
  };

  /** The pointer, path and reveal button of the selected row; the raw view follows it. */
  const selectRow = (/** @type {Row} */ row) => {
    const node = row.chain?.at(-1) ?? row;
    const pointer = row.pointer ?? pointerOf(row.chain);
    $.pointer.textContent = pointer;
    $.dotted.textContent = row.dotted ?? pathOf(row.chain);
    $.where.dataset.root = pointer === "" ? "true" : "false";
    const masked = !row.group && (row.masked ?? isMasked(row.chain, maskKeys));
    $.reveal.hidden = !masked;
    $.reveal.textContent = revealed === row.key ? "Hide value" : "Reveal value";
    if (node && !row.group) raw.goTo(node.line, node.col);
  };

  const reveal = (/** @type {Row} */ row) => {
    revealed = revealed === row.key ? null : row.key;
    tree.mask(maskKeys, revealed);
    raw.mask(hiddenRanges());
    selectRow(row);
    say(revealed ? `Showing the value of ${row.label}.` : `Hid the value of ${row.label}.`);
  };

  const { tree, raw } = createPanes(doc, $, { select: selectRow, status: say, reveal });
  const panel = createPanel(doc, byId("problems"), {
    line: (line, col) => {
      if (stateOf()?.mode === "tree") setMode("both");
      raw.goTo(line, col);
    },
    node: (error) =>
      safely(async () => {
        if (model?.opened.remote) {
          const active = model;
          const path = await active.opened.remote.request("resolve", error);
          if (active !== model) return;
          if (path) await tree.reveal(path);
          return tree.focus();
        }
        const root = docOf()?.roots[error.root ?? 0];
        const chain = root ? resolve(root, error.pointer) : undefined;
        if (!chain) return;
        const path = [error.root ?? 0];
        for (let i = 1; i < chain.length; i++)
          path.push(
            childrenOf(/** @type {*} */ (chain[i - 1])).indexOf(/** @type {*} */ (chain[i])),
          );
        tree.reveal(path);
        tree.focus();
      }),
  });

  const stateOf = () => (model ? states.get(model.buffer) : undefined);

  const setMode = (/** @type {Mode} */ mode) => {
    const state = stateOf();
    const rawOnly = !docOf();
    const shown = rawOnly ? "raw" : mode;
    if (state) state.mode = shown;
    for (const [name, button] of Object.entries(modes)) {
      button.setAttribute("aria-pressed", String(name === shown));
      /** @type {HTMLButtonElement} */ (button).disabled = rawOnly && name !== "raw";
    }
    $.treePane.hidden = shown === "raw";
    $.rawPane.hidden = shown === "tree";
    $.panes.dataset.mode = shown;
  };

  const resetSearch = () => {
    found = { query: "", matches: [], more: false, at: -1 };
    $.count.textContent = "";
  };

  /** Go to the next (or previous) match, searching first when the query changed. */
  const nextMatch = async (step) => {
    const data = docOf();
    const query = $.search.value.trim();
    if (!data || query === "") return resetSearch();
    if (query !== found.query) {
      const active = model;
      const { matches, more } = model?.opened.remote
        ? await model.opened.remote.request("search", { query })
        : search(data, query, (chain) => isMasked(chain, maskKeys));
      if (active !== model || query !== $.search.value.trim()) return;
      found = { query, matches, more, at: -1 };
    }
    const total = found.matches.length;
    if (total === 0) {
      $.count.textContent = `No matches for ${query}`;
      return;
    }
    found.at = (found.at + step + total) % total;
    const match = /** @type {import("./search.js").Match} */ (found.matches[found.at]);
    tree.reveal(match.path);
    if (model?.opened.remote) {
      const active = model;
      const node = await model.opened.remote.request("node", { path: match.path });
      if (active === model)
        $.count.textContent = `${found.at + 1} of ${total}${found.more ? "+" : ""} · ${node.dotted || "the root"}${node.branch ? "" : ` = ${node.preview}`}`;
      return;
    }
    const chain = chainOf(data, match.path);
    const node = chain.at(-1);
    const value =
      !node || isBranch(node) ? "" : ` = ${isMasked(chain, maskKeys) ? MASK : previewOf(node)}`;
    const where = pathOf(chain) || "the root";
    $.count.textContent = `${found.at + 1} of ${total}${found.more ? "+" : ""} · ${where}${value}`;
  };
  const next = (step = 1) => safely(() => nextMatch(step));

  for (const [name, button] of Object.entries(modes))
    button.addEventListener("click", () => setMode(/** @type {Mode} */ (name)));
  byId("expand-all").addEventListener("click", () => tree.expandAll());
  byId("collapse-all").addEventListener("click", () => tree.collapseAll());
  $.validate.addEventListener("click", () => safely(() => actions.validateWith()));
  byId("search-next").addEventListener("click", () => next());
  $.reveal.addEventListener("click", () => {
    const row = tree.selected();
    if (row) reveal(row);
  });
  $.search.addEventListener("input", () => {
    if ($.search.value.trim() !== found.query) $.count.textContent = "";
  });
  $.search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      next(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape" && $.search.value !== "") {
      event.preventDefault();
      $.search.value = "";
      resetSearch();
      tree.focus();
    }
  });
  doc.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "f") {
      event.preventDefault();
      $.search.focus();
      $.search.select();
    } else if (key === "g") {
      event.preventDefault();
      next(event.shiftKey ? -1 : 1);
    }
  });

  const showDetails = (/** @type {Shown} */ shown) => {
    $.panes.hidden = true;
    $.where.hidden = true;
    $.details.hidden = false;
    byId("details-name").textContent = shown.name;
    byId("details-size").textContent = sizeText(shown.size);
    byId("details-format").textContent = shown.opened.label;
    byId("details-reason").textContent = shown.opened.reason ?? "";
    panel.show(null, null);
  };

  byId("progress").addEventListener("desk-cancel", () => actions.cancel?.());

  return {
    progress(state) {
      const progress = byId("progress");
      progress.hidden = !state;
      if (!state) return;
      const total = state.total.toLocaleString("en-US");
      progress.setAttribute(
        "label",
        `${state.phase} · ${state.done.toLocaleString("en-US")} of ${total} bytes`,
      );
      if (state.total > 0) progress.setAttribute("value", String(state.done / state.total));
      else progress.removeAttribute("value");
    },
    /** @param {Shown | null} next */
    show(next) {
      model = next;
      revealed = null;
      resetSearch();
      $.name.textContent = next ? next.name : "No file open";
      $.path.textContent = next?.path ?? "";
      $.format.textContent = next ? next.opened.label : "";
      $.toolbar.hidden = !next || next.opened.reason !== undefined;
      $.validate.hidden = !next || !CHECKED.has(next.opened.format) || !next.opened.doc;
      $.note.hidden = !next?.opened.note;
      $.note.textContent = next?.opened.note ?? "";
      $.details.hidden = true;
      if (!next) {
        tree.load(null, { expanded: new Set(), selected: null }, true);
        raw.load(null, [], []);
        $.panes.hidden = true;
        $.where.hidden = true;
        panel.show(null, null);
        return;
      }
      if (next.opened.reason !== undefined) return showDetails(next);
      maskKeys = next.maskKeys;
      const data = next.opened.doc ?? null;
      let state = states.get(next.buffer);
      if (!state || state.selected === null) {
        const open =
          (data?.roots.length ?? 0) <= 20 ? (data?.roots ?? []).map((_, i) => String(i)) : [];
        state = { expanded: new Set(open), selected: null, mode: state?.mode ?? "both" };
        states.set(next.buffer, state);
      }
      $.panes.hidden = false;
      $.where.hidden = !data;
      setMode(state.mode);
      $.tree.setAttribute("aria-label", `Tree of ${next.name}`);
      $.raw.setAttribute("aria-label", `Raw text of ${next.name}`);
      // The worker must forget a previously revealed value before the raw viewport requests lines.
      if (next.opened.remote) tree.load(data, state, maskKeys, next.opened.remote);
      raw.load(next.opened, data ? maskRanges(data, maskKeys) : [], data?.errors ?? []);
      if (!next.opened.remote) tree.load(data, state, maskKeys);
      panel.show(next.opened, next.schema);
    },
    /** @param {string} buffer @param {SchemaState} state */
    schema(buffer, state) {
      if (!model || model.buffer !== buffer) return;
      model.schema = state;
      panel.schema(state);
    },
    /** @param {boolean} keys */
    mask(keys) {
      maskKeys = keys;
      revealed = null;
      if (!model) return;
      model.maskKeys = keys;
      tree.mask(keys, null);
      raw.mask(hiddenRanges());
      const row = tree.selected();
      if (row) selectRow(row);
    },
    /** @param {string} text */
    status: say,
    focus() {
      if (!model) return;
      if (!$.details.hidden) $.details.focus();
      else if (stateOf()?.mode === "raw") raw.focus();
      else tree.focus();
    },
  };
}
