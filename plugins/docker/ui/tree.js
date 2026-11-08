// One list of rows with a cursor the keys move (a roving tabindex, ARIA tree or grid rows), folding
// headings and marks. The list on the left and each panel of the pane use one; the renderers make
// the rows and this keeps where the cursor and the marks are across draws.

/**
 * @typedef {import("./actions.js").Item} Item
 * @typedef {{ el: HTMLElement, item: Item | undefined, level: number, fold?: string,
 *   key?: string, group?: string[], markable?: boolean, expanded?: boolean }} RowSpec
 */

/** How many rows PageUp and PageDown move. */
const PAGE = 10;

/** Each drawn row's spec by its element, in every list, for what a press on it drags (view-dnd.js). */
const SPECS = new WeakMap();

/** The spec of the row an element is in, whichever list drew it. @returns {RowSpec | undefined} */
export function specOf(/** @type {unknown} */ target) {
  const row = /** @type {Element | null} */ (target)?.closest?.("[data-index]");
  return row ? SPECS.get(row) : undefined;
}

/**
 * @param {Document} doc
 * @param {HTMLElement} root The element with role tree (or grid) the rows go in.
 * @param {{ activate?(spec: RowSpec): void, changed?(): void }} [hooks]
 *   `activate` runs on Enter and a double click; `changed` when the marks change.
 */
export function createTree(doc, root, hooks = {}) {
  /** @type {RowSpec[]} */
  let rows = [];
  let cursor = 0;
  /** What the cursor was on, so a draw keeps it there. */
  let cursorKey = "";
  /** @type {Set<string>} */
  const folded = new Set();
  /** @type {Set<string>} */
  let marks = new Set();

  const keyOf = (/** @type {RowSpec | undefined} */ spec) =>
    spec?.key ?? spec?.fold ?? (spec?.item ? JSON.stringify(spec.item) : "");

  /**
   * Whether a heading is open. A fold key starting with + is open while it is in the set (a JSON
   * tree's deep nodes start folded); any other is open while it is not.
   */
  const isOpenRow = (/** @type {RowSpec} */ spec) =>
    spec.expanded ??
    (spec.fold?.startsWith("+") ? folded.has(spec.fold) : !folded.has(spec.fold ?? ""));
  const setOpen = (/** @type {string} */ key, /** @type {boolean} */ open) => {
    if (key.startsWith("+") === open) folded.add(key);
    else folded.delete(key);
  };

  const paint = (/** @type {RowSpec} */ spec, /** @type {number} */ index) => {
    const here = index === cursor;
    spec.el.tabIndex = here ? 0 : -1;
    spec.el.classList.toggle("is-cursor", here);
    spec.el.classList.toggle("is-marked", !!spec.markable && marks.has(keyOf(spec)));
    if (spec.markable) spec.el.setAttribute("aria-selected", String(marks.has(keyOf(spec))));
    else if (spec.group) {
      const all = spec.group.length > 0 && spec.group.every((k) => marks.has(k));
      spec.el.setAttribute("aria-selected", String(all));
    } else spec.el.setAttribute("aria-selected", String(here));
  };

  /**
   * Draw `specs`; `nodes` are what goes in the root when the rows sit inside other elements (the
   * overview's cards). The cursor stays on the row it was on, or as near as there is.
   * @param {RowSpec[]} specs
   * @param {Node[]} [nodes]
   */
  const set = (specs, nodes) => {
    const focused = root.contains(doc.activeElement) && doc.activeElement !== root;
    rows = specs;
    const found = cursorKey === "" ? -1 : rows.findIndex((spec) => keyOf(spec) === cursorKey);
    cursor = found >= 0 ? found : Math.min(cursor, Math.max(0, rows.length - 1));
    const present = new Set(rows.map(keyOf));
    marks = new Set([...marks].filter((key) => present.has(key)));
    rows.forEach((spec, index) => {
      if (!spec.el.getAttribute("role")) spec.el.setAttribute("role", "treeitem");
      spec.el.setAttribute("aria-level", String(spec.level));
      if (spec.fold) spec.el.setAttribute("aria-expanded", String(isOpenRow(spec)));
      spec.el.dataset.index = String(index);
      SPECS.set(spec.el, spec);
      paint(spec, index);
    });
    root.replaceChildren(...(nodes ?? rows.map((spec) => spec.el)));
    if (focused) rows[cursor]?.el.focus();
  };

  const moveTo = (/** @type {number} */ index, focus = true) => {
    if (rows.length === 0) return;
    const before = cursor;
    cursor = Math.max(0, Math.min(rows.length - 1, index));
    const spec = rows[cursor];
    if (!spec) return;
    cursorKey = keyOf(spec);
    if (rows[before]) paint(/** @type {RowSpec} */ (rows[before]), before);
    paint(spec, cursor);
    if (focus) spec.el.focus();
    spec.el.scrollIntoView?.({ block: "nearest" });
  };

  /** The heading the cursor is on or under. */
  const headingAt = () => {
    let at = cursor;
    while (at >= 0 && !rows[at]?.fold) at--;
    return at;
  };

  /** @param {(key: string) => boolean} pick @param {boolean} on */
  const markWhere = (pick, on) => {
    for (const spec of rows) {
      const key = keyOf(spec);
      if (spec.markable && pick(key)) {
        if (on) marks.add(key);
        else marks.delete(key);
      }
    }
    rows.forEach(paint);
    hooks.changed?.();
  };

  return {
    set,
    folded,
    rows: () => rows,
    /** Move: next, previous, first, last, a page down or up. */
    move(/** @type {string} */ action) {
      const to = {
        next: cursor + 1,
        previous: cursor - 1,
        first: 0,
        last: rows.length - 1,
        pageDown: cursor + PAGE,
        pageUp: cursor - PAGE,
      }[action];
      if (to !== undefined) moveTo(to);
    },
    moveTo,
    /**
     * Fold (`open` false) or unfold (`open` true) the heading the cursor is on or under; on a row
     * that does not fold, ← goes to its heading. The caller draws again.
     */
    fold(/** @type {boolean | undefined} */ open) {
      const at = headingAt();
      const key = rows[at]?.fold;
      if (!key) return false;
      const isOpen = isOpenRow(/** @type {RowSpec} */ (rows[at]));
      if (open === false && at !== cursor) {
        moveTo(at);
        return false;
      }
      if (open !== undefined && (at !== cursor || open === isOpen)) return false;
      setOpen(key, !isOpen);
      cursorKey = keyOf(rows[at]);
      return true;
    },
    /** Mark or unmark the row under the cursor (a heading: all its rows), then go down one. */
    mark() {
      const spec = rows[cursor];
      if (!spec) return;
      if (spec.group?.length) {
        const on = !spec.group.every((k) => marks.has(k));
        const keys = new Set(spec.group);
        markWhere((key) => keys.has(key), on);
      } else if (spec.markable) {
        const key = keyOf(spec);
        markWhere((k) => k === key, !marks.has(key));
      } else return;
      moveTo(cursor + 1);
    },
    /** Mark every row shown, or clear the marks when they all are. */
    markAll() {
      const markable = rows.filter((spec) => spec.markable).map(keyOf);
      const on = !markable.every((key) => marks.has(key));
      markWhere(() => true, on);
    },
    clearMarks() {
      if (marks.size === 0) return false;
      marks.clear();
      rows.forEach(paint);
      hooks.changed?.();
      return true;
    },
    /** The marked rows' items, in the list's order. */
    marked: () =>
      rows
        .filter((spec) => spec.markable && marks.has(keyOf(spec)))
        .flatMap((spec) => (spec.item ? [spec.item] : [])),
    /** Mark exactly the rows whose items are `items`. */
    setMarks(/** @type {Item[]} */ items) {
      const wanted = new Set(items.map((item) => JSON.stringify(item)));
      marks = new Set(
        rows.filter((spec) => spec.item && wanted.has(JSON.stringify(spec.item))).map(keyOf),
      );
      rows.forEach(paint);
      hooks.changed?.();
    },
    selection: () => rows[cursor]?.item,
    current: () => rows[cursor],
    activate() {
      const spec = rows[cursor];
      if (spec) hooks.activate?.(spec);
    },
    focus() {
      const spec = rows[cursor];
      if (spec) spec.el.focus();
      else root.focus();
    },
    /** The row a click or double click landed on, made the cursor's. */
    hit(/** @type {EventTarget | null} */ target) {
      const el = /** @type {HTMLElement | null} */ (target)?.closest?.("[data-index]");
      if (!el || !root.contains(el)) return undefined;
      const index = Number(/** @type {HTMLElement} */ (el).dataset.index);
      if (Number.isNaN(index)) return undefined;
      moveTo(index);
      return rows[index];
    },
  };
}
