// The tree of entries: a virtual list (only the rows in sight are in the DOM) with the ARIA tree
// pattern on one focusable element (aria-activedescendant), sizes, dates, methods, a lock on
// encrypted entries and a mark for "Extract selected".
import { formatSize } from "./bytes.js";

/** @typedef {import("./tree.js").Row} Row */
/** @typedef {{ select(id: string): unknown, toggle(id: string): unknown, open(id: string): unknown, mark(id: string): unknown }} TreeActions */

export const ROW = 24;
/** Rows drawn when the list has no height yet (a hidden frame, a test). */
const FALLBACK = 100;

const LOCK =
  '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M3.5 5V3.6a2.5 2.5 0 0 1 5 0V5" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="2" y="5" width="8" height="6" rx="1.2" fill="currentColor"/></svg>';

/** @param {Document} doc @param {HTMLElement} tree @param {TreeActions} actions */
export function createTree(doc, tree, actions) {
  const space = doc.createElement("div");
  space.className = "space";
  tree.append(space);
  /** @type {Row[]} */
  let rows = [];
  /** @type {string | null} */
  let selected = null;
  let anyMarked = false;

  /** @param {Row} row @param {number} index */
  const element = (row, index) => {
    const el = doc.createElement("div");
    el.className = `row kind-${row.kind}${row.outside ? " outside" : ""}`;
    el.id = `row-${index}`;
    el.setAttribute("role", "treeitem");
    el.dataset.id = row.id;
    el.dataset.name = row.name;
    el.style.top = `${index * ROW}px`;
    el.setAttribute("aria-level", String(row.depth));
    el.setAttribute("aria-setsize", String(row.setsize));
    el.setAttribute("aria-posinset", String(row.posinset));
    el.setAttribute("aria-selected", String(row.id === selected));
    if (row.expanded !== undefined) el.setAttribute("aria-expanded", String(row.expanded));
    if (anyMarked) el.setAttribute("aria-checked", String(row.marked));
    const size = row.size >= 0 ? formatSize(row.size) : "";
    const parts = [
      row.name,
      row.kind === "folder" ? "folder" : row.kind === "link" ? "link" : "",
      row.encrypted ? "encrypted, not extracted" : "",
      row.outside ? "outside the folder" : "",
      size,
    ];
    el.setAttribute("aria-label", parts.filter(Boolean).join(", "));
    const name = doc.createElement("span");
    name.className = "name";
    name.style.paddingLeft = `${(row.depth - 1) * 16 + 4}px`;
    const twisty = doc.createElement("span");
    twisty.className = "twisty";
    twisty.setAttribute("aria-hidden", "true");
    twisty.textContent = row.expanded === undefined ? "" : row.expanded ? "▾" : "▸";
    const mark = doc.createElement("span");
    mark.className = "mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = row.marked ? "✓" : "";
    const label = doc.createElement("span");
    label.className = "label";
    label.textContent = row.name;
    name.append(twisty, mark, label);
    if (row.link !== undefined) {
      const link = doc.createElement("span");
      link.className = "link";
      link.textContent = ` → ${row.link}`;
      name.append(link);
    }
    if (row.encrypted) {
      const lock = doc.createElement("span");
      lock.dataset.lock = "";
      lock.className = "lock";
      lock.title = "Encrypted: not extracted";
      lock.innerHTML = LOCK;
      name.append(lock);
    }
    const cell = (/** @type {string} */ text, /** @type {string} */ cls) => {
      const c = doc.createElement("span");
      c.className = cls;
      c.textContent = text;
      return c;
    };
    el.append(
      name,
      cell(size, "size"),
      cell(row.packed !== undefined && row.packed >= 0 ? formatSize(row.packed) : "", "packed"),
      cell(row.date, "date"),
      cell(row.method, "method"),
    );
    return el;
  };

  const draw = () => {
    space.style.height = `${rows.length * ROW}px`;
    const height = tree.clientHeight;
    const first = height ? Math.max(0, Math.floor(tree.scrollTop / ROW) - 10) : 0;
    const count = height ? Math.ceil(height / ROW) + 20 : FALLBACK;
    const at = rows.findIndex((r) => r.id === selected);
    const indexes = new Set();
    for (let i = first; i < Math.min(rows.length, first + count); i++) indexes.add(i);
    if (at >= 0) indexes.add(at);
    space.replaceChildren(
      ...[...indexes].sort((a, b) => a - b).map((i) => element(/** @type {Row} */ (rows[i]), i)),
    );
    if (at >= 0) tree.setAttribute("aria-activedescendant", `row-${at}`);
    else tree.removeAttribute("aria-activedescendant");
  };

  tree.addEventListener("scroll", () => draw());
  tree.addEventListener("click", (event) => {
    const row = /** @type {HTMLElement | null} */ (
      /** @type {HTMLElement} */ (event.target).closest?.("[data-id]")
    );
    if (!row?.dataset.id) return;
    tree.focus();
    if (/** @type {HTMLElement} */ (event.target).closest(".twisty"))
      actions.toggle(row.dataset.id);
    else actions.select(row.dataset.id);
  });
  tree.addEventListener("dblclick", (event) => {
    const row = /** @type {HTMLElement | null} */ (
      /** @type {HTMLElement} */ (event.target).closest?.("[data-id]")
    );
    const found = rows.find((r) => r.id === row?.dataset.id);
    if (!found) return;
    if (found.kind === "folder") actions.toggle(found.id);
    else actions.open(found.id);
  });

  /** Move the selection by `delta` rows, or to `index`. @param {number} index */
  const go = (index) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!row) return;
    const top = rows.indexOf(row) * ROW;
    if (top < tree.scrollTop) tree.scrollTop = top;
    else if (top + ROW > tree.scrollTop + tree.clientHeight && tree.clientHeight)
      tree.scrollTop = top + ROW - tree.clientHeight;
    actions.select(row.id);
  };

  tree.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const at = rows.findIndex((r) => r.id === selected);
    const row = rows[at];
    const page = Math.max(1, Math.floor(tree.clientHeight / ROW) - 1) || 10;
    const keys = /** @type {Record<string, () => void>} */ ({
      ArrowDown: () => go(at + 1),
      ArrowUp: () => go(at < 0 ? 0 : at - 1),
      PageDown: () => go(at + page),
      PageUp: () => go(at - page),
      Home: () => go(0),
      End: () => go(rows.length - 1),
      ArrowRight: () => {
        if (row?.expanded === false) actions.toggle(row.id);
        else if (row?.expanded) go(at + 1);
      },
      ArrowLeft: () => {
        if (row?.expanded) return void actions.toggle(row.id);
        for (let i = at - 1; i >= 0; i--)
          if ((rows[i]?.depth ?? 0) < (row?.depth ?? 0)) return go(i);
      },
      Enter: () => {
        if (!row) return;
        if (row.kind === "folder") actions.toggle(row.id);
        else actions.open(row.id);
      },
      " ": () => {
        if (row) actions.mark(row.id);
      },
    });
    const handle = keys[event.key];
    if (!handle) return;
    event.preventDefault();
    handle();
  });

  return {
    /** @param {Row[]} next @param {string | null} id */
    render(next, id) {
      rows = next;
      selected = id;
      anyMarked = next.some((r) => r.marked);
      draw();
    },
  };
}
