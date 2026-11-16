// The list every section draws: sortable columns, rows marked with checkboxes (Shift extends),
// optional groups that fold (a Compose stack over its containers), a menu on right-click, keys to
// move, mark and open, and live cells that redraw in place without touching the rest.

import { h, icon } from "./dom.js";

/**
 * @template T
 * @typedef {{ key: string, title: string, width?: string, cls?: string, live?: boolean,
 *   sort?: (a: T, b: T) => number, cell: (row: T) => import("./dom.js").Child | import("./dom.js").Child[] }} Column
 */
/**
 * @template T
 * @typedef {{ key: string, title: string, rows: T[], head?: (rows: T[]) => import("./dom.js").Child[] }} Group
 */

/**
 * @template T
 * @param {{ label: string, columns: Column<T>[], keyOf: (row: T) => string,
 *   open?: (row: T) => void, menu?: (rows: T[], at: { x: number, y: number } | HTMLElement) => void,
 *   selected?: (keys: Set<string>) => void, empty?: () => HTMLElement, groupMenu?: (group: Group<T>, at: HTMLElement) => void,
 *   sortKey?: string, sortDir?: 1 | -1, onSort?: (key: string, dir: 1 | -1) => void, rowClass?: (row: T) => string }} spec
 */
export function createTable(spec) {
  /** @type {Set<string>} */
  const marks = new Set();
  /** @type {Set<string>} */
  const folded = new Set();
  /** @type {Map<string, { row: T, tr: HTMLElement }>} */
  const rendered = new Map();
  /** @type {Group<T>[]} */
  let groups = [];
  let sortKey = spec.sortKey ?? "";
  let sortDir = spec.sortDir ?? 1;
  /** @type {string | null} */
  let anchor = null;
  /** @type {string | null} */
  let cursor = null;

  const all = /** @type {HTMLInputElement} */ (
    h("input.desk-check", {
      type: "checkbox",
      "aria-label": "Mark every row",
      onChange: () => markAll(all.checked),
    })
  );
  const headRow = h("tr");
  const thead = h("thead", null, headRow);
  const tbody = h("tbody");
  const colgroup = h(
    "colgroup",
    null,
    h("col", { style: { width: "40px" } }),
    spec.columns.map((c) => h("col", { style: c.width ? { width: c.width } : {} })),
  );
  const table = h(
    "table.dtable",
    { role: "grid", "aria-label": spec.label, "aria-multiselectable": "true" },
    colgroup,
    thead,
    tbody,
  );
  const element = h("div.table-wrap", { tabindex: "0" }, table);

  const drawHead = () => {
    headRow.replaceChildren(
      h("th.check-cell", { scope: "col" }, all),
      ...spec.columns.map((c) => {
        const sorted = c.key === sortKey;
        const label = h("span", null, c.title);
        if (!c.sort) return h(`th.${c.cls ?? "col"}`, { scope: "col" }, label);
        return h(
          `th.${c.cls ?? "col"}.sortable`,
          {
            scope: "col",
            "aria-sort": sorted ? (sortDir === 1 ? "ascending" : "descending") : "none",
          },
          h(
            "button.desk-btn.desk-btn-quiet.sort-btn",
            {
              type: "button",
              onClick: () => {
                sortDir = sorted ? /** @type {1 | -1} */ (-sortDir) : 1;
                sortKey = c.key;
                spec.onSort?.(sortKey, sortDir);
                drawHead();
                draw();
              },
            },
            label,
            sorted ? icon(sortDir === 1 ? "chevronDown" : "chevronDown", 12) : null,
          ),
        );
      }),
    );
    const th = headRow.querySelector("th[aria-sort='descending'] .icon");
    th?.classList.add("flip");
  };

  const sorted = (/** @type {T[]} */ rows) => {
    const col = spec.columns.find((c) => c.key === sortKey);
    if (!col?.sort) return rows;
    const by = col.sort;
    return [...rows].sort((a, b) => by(a, b) * sortDir);
  };

  const keys = () =>
    groups.flatMap((g) => (folded.has(g.key) ? [] : sorted(g.rows).map(spec.keyOf)));

  const rowOf = (/** @type {T} */ row) => {
    const key = spec.keyOf(row);
    const check = h("input.desk-check", {
      type: "checkbox",
      "aria-label": "Mark",
      checked: marks.has(key),
      onClick: (/** @type {MouseEvent} */ e) => {
        e.stopPropagation();
        toggle(key, e.shiftKey);
      },
    });
    const tr = h(
      `tr.row-item${spec.rowClass ? `.${spec.rowClass(row) || "plain"}` : ""}`,
      {
        dataset: { key },
        "aria-selected": marks.has(key) ? "true" : "false",
        onClick: (/** @type {MouseEvent} */ e) => {
          if (/** @type {HTMLElement} */ (e.target).closest("button, a, input")) return;
          cursor = key;
          if (e.metaKey || e.ctrlKey) toggle(key, false);
          else if (e.shiftKey) toggle(key, true);
          else spec.open?.(row);
        },
        onContextmenu: (/** @type {MouseEvent} */ e) => {
          e.preventDefault();
          const chosen = marks.has(key) ? selection() : [row];
          spec.menu?.(chosen, { x: e.clientX, y: e.clientY });
        },
      },
      h("td.check-cell", null, check),
      spec.columns.map((c) => h(`td.${c.cls ?? "col"}`, { dataset: { col: c.key } }, c.cell(row))),
    );
    rendered.set(key, { row, tr });
    return tr;
  };

  const groupRow = (/** @type {Group<T>} */ g) => {
    const open = !folded.has(g.key);
    const gkeys = g.rows.map(spec.keyOf);
    const allMarked = gkeys.length > 0 && gkeys.every((k) => marks.has(k));
    return h(
      "tr.group-row",
      { dataset: { group: g.key } },
      h(
        "td.check-cell",
        null,
        h("input.desk-check", {
          type: "checkbox",
          "aria-label": `Mark ${g.title}`,
          checked: allMarked,
          onChange: () => {
            for (const k of gkeys) allMarked ? marks.delete(k) : marks.add(k);
            changed();
          },
        }),
      ),
      h(
        "td.group-cell",
        { colspan: String(spec.columns.length) },
        h(
          "div.group-line",
          null,
          h(
            "button.desk-btn.desk-btn-quiet.fold",
            {
              type: "button",
              "aria-expanded": open ? "true" : "false",
              "aria-label": `${open ? "Fold" : "Unfold"} ${g.title}`,
              onClick: () => {
                if (open) folded.add(g.key);
                else folded.delete(g.key);
                draw();
              },
            },
            icon(open ? "chevronDown" : "chevronRight", 14),
          ),
          ...(g.head?.(g.rows) ?? [h("b", null, g.title)]),
        ),
      ),
    );
  };

  const draw = () => {
    rendered.clear();
    /** @type {HTMLElement[]} */
    const out = [];
    for (const g of groups) {
      if (g.key) out.push(groupRow(g));
      if (!folded.has(g.key)) for (const row of sorted(g.rows)) out.push(rowOf(row));
    }
    if (out.length === 0 && spec.empty)
      out.push(
        h(
          "tr.empty-row",
          null,
          h("td", { colspan: String(spec.columns.length + 1) }, spec.empty()),
        ),
      );
    tbody.replaceChildren(...out);
    syncAll();
    if (cursor) rendered.get(cursor)?.tr.classList.add("cursor");
  };

  const syncAll = () => {
    const visible = keys();
    all.checked = visible.length > 0 && visible.every((k) => marks.has(k));
    all.indeterminate = !all.checked && visible.some((k) => marks.has(k));
  };

  const changed = () => {
    for (const [key, { tr }] of rendered) {
      tr.setAttribute("aria-selected", marks.has(key) ? "true" : "false");
      const box = /** @type {HTMLInputElement | null} */ (tr.querySelector(".check-cell input"));
      if (box) box.checked = marks.has(key);
    }
    for (const tr of tbody.querySelectorAll("tr.group-row")) {
      const g = groups.find((x) => x.key === /** @type {HTMLElement} */ (tr).dataset.group);
      const box = /** @type {HTMLInputElement | null} */ (tr.querySelector("input"));
      if (g && box)
        box.checked = g.rows.length > 0 && g.rows.every((r) => marks.has(spec.keyOf(r)));
    }
    syncAll();
    spec.selected?.(new Set(marks));
  };

  const toggle = (/** @type {string} */ key, /** @type {boolean} */ extend) => {
    if (extend && anchor) {
      const list = keys();
      const [a, b] = [list.indexOf(anchor), list.indexOf(key)].sort((x, y) => x - y);
      if (a >= 0 && b >= 0) for (const k of list.slice(a, (b ?? a) + 1)) marks.add(k);
    } else if (marks.has(key)) marks.delete(key);
    else marks.add(key);
    anchor = key;
    changed();
  };

  const markAll = (/** @type {boolean} */ on) => {
    for (const k of keys()) on ? marks.add(k) : marks.delete(k);
    changed();
  };

  const selection = () => groups.flatMap((g) => g.rows).filter((row) => marks.has(spec.keyOf(row)));

  const move = (/** @type {number} */ by) => {
    const list = keys();
    if (list.length === 0) return;
    const at = cursor ? list.indexOf(cursor) : -1;
    const next = list[Math.min(list.length - 1, Math.max(0, at + by))] ?? list[0];
    for (const { tr } of rendered.values()) tr.classList.remove("cursor");
    cursor = next ?? null;
    const tr = cursor ? rendered.get(cursor)?.tr : undefined;
    tr?.classList.add("cursor");
    tr?.scrollIntoView({ block: "nearest" });
  };

  element.addEventListener("keydown", (e) => {
    if (/** @type {HTMLElement} */ (e.target).tagName === "INPUT") return;
    const current = cursor ? rendered.get(cursor)?.row : undefined;
    if (e.key === "ArrowDown" || e.key === "j") move(1);
    else if (e.key === "ArrowUp" || e.key === "k") move(-1);
    else if (e.key === " " && cursor) toggle(cursor, e.shiftKey);
    else if (e.key === "Enter" && current) spec.open?.(current);
    else if (e.key === "Escape" && marks.size) {
      marks.clear();
      changed();
    } else return;
    e.preventDefault();
  });

  drawHead();
  return {
    element,
    /** Show these groups (one with key "" draws no group row). @param {Group<T>[]} next */
    set(next) {
      groups = next;
      const present = new Set(next.flatMap((g) => g.rows.map(spec.keyOf)));
      for (const k of [...marks]) if (!present.has(k)) marks.delete(k);
      draw();
      spec.selected?.(new Set(marks));
    },
    /** Redraw only the live columns of the rows on screen. */
    tick() {
      const live = spec.columns.filter((c) => c.live);
      for (const { row, tr } of rendered.values())
        for (const c of live) {
          const td = tr.querySelector(`td[data-col="${c.key}"]`);
          if (td)
            td.replaceChildren(
              ...[c.cell(row)]
                .flat()
                .filter((x) => x !== null && x !== undefined && x !== false)
                .map((x) => (typeof x === "object" ? x : document.createTextNode(String(x)))),
            );
        }
    },
    selection,
    clear() {
      marks.clear();
      changed();
    },
    /** Mark one row as busy (an operation runs on it). */
    busy(/** @type {string} */ key, /** @type {boolean} */ on) {
      rendered.get(key)?.tr.classList.toggle("busy", on);
    },
    focus() {
      element.focus();
    },
  };
}
