// The table form (features/README.md, PG-51): where it is (the connection, the server, its tag),
// the table's schema and name, the sections as tabs (columns, keys, foreign keys, indexes, the
// table's comment, owner and partitioning), and below them the script as it grows, each dangerous
// step under its marks, what the form will not write said, and Run (in one transaction), Dry run
// and Open in console; a read-only connection gets no Run. Typing rewrites the script in place and
// leaves the field as it is (an input method's composition goes on); every edit applies to the
// design as it is then, so a click after typing keeps what was typed. A change of shape draws the
// form again, and so does leaving a line, once the press that left it is over (so its click lands);
// the control that had the focus keeps it. Mod+Enter runs. Layout and colours: table-design.css.

import { el } from "../../dom.js";
import { selectField, textField } from "./bits.js";
import { columnsView } from "./columns-view.js";
import { setTable } from "./edits.js";
import { indexesView, tableView } from "./indexes-view.js";
import { foreignView, keysView } from "./keys-view.js";
import { living } from "./model.js";
import { refusalOf } from "./runs.js";
import { scriptParts } from "./script-view.js";

/**
 * @typedef {import("./controller.js").DesignState} DesignState
 * @typedef {import("./controller.js").Tab} Tab
 * @typedef {import("./model.js").Design} Design
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const TABS = /** @type {[Tab, string][]} */ ([
  ["columns", "Columns"],
  ["keys", "Keys"],
  ["foreign", "Foreign keys"],
  ["indexes", "Indexes"],
  ["table", "Table"],
]);
const HINTS = "Mod+Enter run";

/** How many parts a tab holds, for its label. */
function countOf(/** @type {Design} */ d, /** @type {Tab} */ tab) {
  if (tab === "columns") return living(d).length;
  if (tab === "keys")
    return (d.primaryKey ? 1 : 0) + d.uniques.length + d.checks.length + d.others.length;
  if (tab === "foreign") return d.foreignKeys.length;
  if (tab === "indexes") return d.indexes.length;
  return -1;
}

/** A line or a box of lines: what keeps a caret. */
const typed = (/** @type {Element | null | undefined} */ n) =>
  n?.tagName === "TEXTAREA" ||
  (n?.tagName === "INPUT" &&
    !["checkbox", "radio"].includes(/** @type {HTMLInputElement} */ (n).type));

/**
 * @param {Document} doc
 * @param {DesignState} first
 * @param {Act} act
 * @param {{ id: string }} buffer
 */
export function tableDesignPanel(doc, first, act, buffer) {
  let state = first;
  const id = buffer.id;
  /** What the form sent last, so a state that only echoes it rewrites the script alone. */
  let local = { design: first.design, tab: first.tab, selected: first.selected };
  const body = el(doc, "div", { class: "td-body" });
  const tail = el(doc, "div", { class: "td-tail" });
  const root = el(doc, "div", { class: "td", tabindex: "-1" }, body, tail);

  /** Edit the design as it is now; `redraw` draws the whole form, else the script alone. */
  const set = (
    /** @type {Design | ((now: Design) => Design)} */ edit,
    /** @type {boolean} */ redraw,
  ) => {
    const now = /** @type {Design} */ (local.design);
    const design = typeof edit === "function" ? edit(now) : edit;
    local = { ...local, design };
    state = { ...state, design, run: null };
    act("tableDesignEdit", id, { design });
    if (redraw) draw();
    else drawTail();
  };
  const select = (/** @type {string} */ item) => {
    const selected = { ...local.selected, [local.tab]: item };
    local = { ...local, selected };
    state = { ...state, selected };
    act("tableDesignEdit", id, { selected });
    draw();
  };
  /** Add a part and show it. */
  const add = (/** @type {(now: Design) => { design: Design, id: string }} */ make) => {
    let made = "";
    set((d) => {
      const out = make(d);
      made = out.id;
      return out.design;
    }, false);
    select(made);
  };
  const tab = (/** @type {Tab} */ next) => {
    local = { ...local, tab: next };
    state = { ...state, tab: next };
    act("tableDesignEdit", id, { tab: next });
    draw();
  };

  // A line left draws the form again (its lists, what its value turns on or off), after the press
  // that left it: a button drawn again under the pointer would lose its click.
  let pressed = false;
  let pending = false;
  const flush = () => {
    if (pressed || !pending) return;
    pending = false;
    if (root.isConnected) draw();
  };
  const press = () => {
    pressed = true;
  };
  const release = () => {
    pressed = false;
    setTimeout(flush, 0);
  };
  doc.addEventListener("pointerdown", press, true);
  doc.addEventListener("pointerup", release, true);
  doc.addEventListener("pointercancel", release, true);
  root.addEventListener("change", (event) => {
    if (!typed(/** @type {Element | null} */ (event.target))) return;
    pending = true;
    setTimeout(flush, 0);
  });

  root.addEventListener("focusin", () => {
    const line = doc.getElementById("hints");
    if (line) line.textContent = HINTS;
  });
  root.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (!refusalOf(state) && state.run?.status !== "running") act("tableDesignRun", id);
    }
  });

  /** The script, the problems, the buttons and the run's result. */
  const drawTail = () => tail.replaceChildren(...scriptParts(doc, state, act, id));

  const draw = () => {
    const s = state;
    const focused = /** @type {HTMLElement | null} */ (doc.activeElement);
    const key = focused && root.contains(focused) ? focused.getAttribute("data-key") : null;
    const caret = typed(focused) ? [focused.selectionStart, focused.selectionEnd] : null;
    const where = s.read?.facts.version
      ? ` · PostgreSQL ${Math.floor(s.read.facts.version / 10000)}`
      : s.reading
        ? " · Reading…"
        : "";
    const title =
      s.mode === "create"
        ? `New table in ${s.target.schema}`
        : `Table ${s.target.schema}.${s.target.name}`;
    const refresh = el(
      doc,
      "button",
      {
        type: "button",
        class: "desk-btn desk-btn-quiet",
        "data-key": "ctl:refresh",
        ...(s.reading || s.run?.status === "running" ? { disabled: true } : {}),
      },
      "Read again",
    );
    refresh.addEventListener("click", () => act("tableDesignRefresh", id));
    const parts = [
      el(
        doc,
        "div",
        { class: "td-head", "data-part": "head" },
        el(
          doc,
          "p",
          { class: "td-title" },
          el(doc, "strong", {}, title),
          ` on ${s.conn.name}${where}`,
          s.conn.tag && s.conn.tag !== "none"
            ? el(doc, "span", { class: `tag tag-${s.conn.tag}` }, s.conn.tag)
            : undefined,
        ),
        refresh,
      ),
    ];
    if (s.error)
      parts.push(
        el(
          doc,
          "div",
          { class: "desk-error", role: "alert", "data-part": "error" },
          el(doc, "p", {}, s.error),
        ),
      );
    const design = s.design;
    if (s.read && design) {
      const schemas = [...new Set([design.schema, ...s.refs.schemas])];
      parts.push(
        el(
          doc,
          "div",
          { class: "td-row td-names" },
          selectField(
            doc,
            {
              key: "table:schema",
              label: "Schema",
              value: design.schema,
              options: schemas.map((n) => ({ value: n, label: n })),
              disabled: s.mode === "change",
              ...(s.mode === "change"
                ? { hint: "Move it to another schema from the explorer." }
                : {}),
            },
            (v) => {
              set((d) => setTable(d, { schema: v }), true);
              act("tableDesignRefs", id, v);
            },
          ),
          textField(
            doc,
            {
              key: "table:name",
              label: "Name",
              value: design.name,
              placeholder: "orders",
              hint: "Written as typed, in quotes.",
            },
            (v) => set((d) => setTable(d, { name: v }), false),
          ),
        ),
      );
      const current = local.tab;
      parts.push(
        el(
          doc,
          "div",
          {
            class: "desk-tabs td-tabs",
            role: "tablist",
            "aria-label": "Parts of the table",
            "data-part": "tabs",
          },
          ...TABS.map(([t, label]) => {
            const n = countOf(design, t);
            const b = el(
              doc,
              "button",
              {
                type: "button",
                class: "desk-tab",
                role: "tab",
                "data-key": `tab:${t}`,
                "aria-selected": String(t === current),
              },
              n >= 0 ? `${label} (${n})` : label,
            );
            b.addEventListener("click", () => tab(t));
            return b;
          }),
        ),
      );
      const ctx = {
        doc,
        design,
        original: s.read.original,
        facts: s.read.facts,
        selected: local.selected[current] ?? "",
        set,
        add,
        select,
        refs: s.refs,
        load: (/** @type {string} */ schema, table = "") =>
          act("tableDesignRefs", id, schema, table),
        partitioned: s.read.partitioned,
      };
      const views = {
        columns: columnsView,
        keys: keysView,
        foreign: foreignView,
        indexes: indexesView,
        table: tableView,
      };
      parts.push(
        el(
          doc,
          "div",
          { class: "td-section", role: "tabpanel", "data-part": current },
          views[current](ctx),
        ),
      );
    }
    body.replaceChildren(...parts);
    drawTail();
    const again = key
      ? /** @type {HTMLElement | undefined} */ (
          [...root.querySelectorAll("[data-key]")].find((n) => n.getAttribute("data-key") === key)
        )
      : undefined;
    again?.focus();
    // The control is gone (a part removed): the form keeps the focus, so its keys still work.
    if (key && doc.activeElement !== again) root.focus();
    if (caret && typed(again)) again.setSelectionRange(caret[0] ?? 0, caret[1] ?? 0);
  };

  draw();
  return {
    el: root,
    destroy() {
      doc.removeEventListener("pointerdown", press, true);
      doc.removeEventListener("pointerup", release, true);
      doc.removeEventListener("pointercancel", release, true);
    },
    update(/** @type {DesignState} */ next) {
      const echo =
        next.design === local.design &&
        next.tab === local.tab &&
        next.selected === local.selected &&
        next.read === state.read &&
        next.refs === state.refs &&
        next.reading === state.reading &&
        next.error === state.error &&
        next.target === state.target;
      state = next;
      local = { design: next.design, tab: next.tab, selected: next.selected };
      if (echo) drawTail();
      else draw();
    },
  };
}
