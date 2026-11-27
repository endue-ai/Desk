// What the grid's keys, its header, its menu and the commands do to the shape of the result on
// screen: the cursor's column hidden, shown, moved, pinned, resized or fitted (columns.js), the sort
// keys (a click sorts by one column, Shift+click or S adds the next), and the quick filters from the
// cursor's cell. A table view's keys and filters go to the server (the grid acts "sort" and
// "filters"); a console's result keeps its own. No DOM: the grid hands in what it holds.

import { t } from "../strings/index.js";
import {
  emptyColumns,
  fitWidth,
  hide,
  move as moveBy,
  moveTo,
  pin,
  resize,
  show,
} from "./columns.js";
import { WITH_VALUE } from "./filters.js";

/**
 * @typedef {import("./shapes.js").Shape} Shape
 * @typedef {import("./columns.js").Layout} Layout
 * @typedef {import("./columns.js").ColumnState} ColumnState
 * @typedef {import("./filters.js").Filter} Filter
 * @typedef {import("./filters.js").SortKey} SortKey
 * @typedef {import("./rows.js").FilterOp} FilterOp
 * @typedef {{
 *   set(): import("../engines/common.js").ResultSet, layout(): Layout, shape(): Shape,
 *   server(): { sort: SortKey[], filters: Filter[] } | null,
 *   column(): number, value(): string | null | undefined, numeric(col: number): boolean,
 *   ch(): number, record(): boolean,
 *   columns(next: ColumnState, follow?: string): void, rows(): void,
 *   act(action: string, ...args: unknown[]): unknown,
 * }} Held
 *   `server` is a table view's keys and filters as the server last ran them (null for a console's
 *   result); `column` the result column under the cursor; `columns` takes a new column state (the
 *   cursor following `follow`), `rows` redraws after a change of keys or filters.
 */

const STEP = 16;

/** @param {Held} g */
export function createShaping(g) {
  /** What a table view asked the server for, until the server's answer is drawn. */
  /** @type {{ sort?: SortKey[], filters?: Filter[] }} */
  let asked = {};
  const keyOf = (/** @type {number} */ col) => g.layout().keys[col] ?? "";
  const cursorKey = () => keyOf(g.column());
  const sortKeys = () => (g.server() ? (asked.sort ?? g.server()?.sort ?? []) : g.shape().sort);
  const filters = () =>
    g.server() ? (asked.filters ?? g.server()?.filters ?? []) : g.shape().filters;
  const columns = (/** @type {ColumnState} */ next, follow = cursorKey()) =>
    next === g.shape().columns ? undefined : g.columns(next, follow);
  const width = (/** @type {string} */ key) => {
    const layout = g.layout();
    const at = layout.visible.findIndex((c) => layout.keys[c] === key);
    return layout.widths[at] ?? 0;
  };

  /** New sort keys: to the server for a table view, else drawn here. */
  const sorted = (/** @type {SortKey[]} */ next) => {
    if (g.server()) {
      asked = { ...asked, sort: next };
      g.act("sort", next);
    } else g.shape().sort = next;
    g.rows();
  };
  /** New quick filters, the same way. */
  const filtered = (/** @type {Filter[]} */ next) => {
    if (g.server()) {
      asked = { ...asked, filters: next };
      g.act("filters", next);
    } else g.shape().filters = next;
    g.rows();
  };

  return {
    sortKeys,
    filters,
    /** The keys and filters the frame orders the rows by: none for a table view (the server's). */
    local() {
      if (g.server()) return { sort: [], filters: [] };
      const at = new Map(g.layout().keys.map((key, i) => [key, i]));
      const of = (/** @type {string} */ key) => at.get(key) ?? 0;
      return {
        sort: sortKeys()
          .filter((k) => at.has(k.key))
          .map((k) => ({ column: of(k.key), direction: k.direction })),
        filters: filters()
          .filter((f) => at.has(f.key))
          .map((f) => ({ column: of(f.key), op: f.op, value: f.value })),
      };
    },
    /** The server drew what it was asked for: its keys and filters are the ones shown again. */
    answered() {
      asked = {};
    },
    hide() {
      if (g.layout().visible.length <= 1) return t("grid.shaping.theLastColumnOnScreenStays");
      columns(hide(g.shape().columns, cursorKey()), "");
      return "";
    },
    show: (/** @type {string} */ key) => columns(show(g.shape().columns, key), key),
    move: (/** @type {number} */ delta) =>
      columns(moveBy(g.shape().columns, g.layout().keys, cursorKey(), delta)),
    /** A header let go at screen position `index`. */
    drop(/** @type {number} */ col, /** @type {number} */ index) {
      const layout = g.layout();
      const key = keyOf(layout.visible[col] ?? -1);
      columns(moveTo(g.shape().columns, layout.keys, key, index), key);
    },
    pin: () => columns(pin(g.shape().columns, g.layout().keys, cursorKey())),
    fit(/** @type {number | undefined} */ col = undefined) {
      const at = col === undefined ? g.column() : (g.layout().visible[col] ?? 0);
      columns(resize(g.shape().columns, keyOf(at), fitWidth(g.set(), at, g.ch())), keyOf(at));
    },
    /** Wider (1) or narrower (-1) by a step. */
    widen: (/** @type {1 | -1} */ by) =>
      columns(resize(g.shape().columns, cursorKey(), width(cursorKey()) + by * STEP)),
    /** A header's grip dragged to `px`; kept when let go. */
    resize(/** @type {number} */ col, /** @type {number} */ px) {
      const key = keyOf(g.layout().visible[col] ?? -1);
      columns(resize(g.shape().columns, key, px), key);
    },
    width: (/** @type {number} */ col) => g.layout().widths[col] ?? 0,
    reset: () => g.columns(emptyColumns(), cursorKey()),
    /**
     * Sort by a result column: alone (ascending, descending, then none), or with `add` as one more
     * key (ascending, descending, then dropped).
     */
    sortBy(/** @type {number} */ col, /** @type {boolean} */ add) {
      if (g.record()) return;
      const key = keyOf(col);
      const keys = sortKeys();
      const at = keys.findIndex((k) => k.key === key);
      const fresh = {
        key,
        name: g.set().columns[col] ?? "",
        direction: /** @type {const} */ ("asc"),
      };
      const flipped = keys.map((k, i) =>
        i === at ? { ...k, direction: /** @type {const} */ ("desc") } : k,
      );
      if (add)
        sorted(
          at < 0
            ? [...keys, fresh]
            : keys[at]?.direction === "asc"
              ? flipped
              : keys.filter((_, i) => i !== at),
        );
      else if (keys.length === 1 && at === 0) sorted(keys[0]?.direction === "asc" ? flipped : []);
      else sorted([fresh]);
    },
    /** Keep the rows whose cursor's column holds `op` (with the cell's value, or `value`). */
    filter(/** @type {FilterOp} */ op, /** @type {string | undefined} */ value = undefined) {
      const col = g.column();
      const cell = g.value();
      if (cell === undefined) return "";
      if (WITH_VALUE.has(op) && cell === null) return t("grid.shaping.aNullCellHasNoValue");
      const key = keyOf(col);
      /** @type {Filter} */
      const next = {
        key,
        name: g.set().columns[col] ?? "",
        op,
        value: op === "contains" ? (value ?? "") : WITH_VALUE.has(op) ? cell : null,
        numeric: g.numeric(col),
      };
      filtered([...filters().filter((f) => f.key !== key || f.op !== op), next]);
      return "";
    },
    removeFilter: (/** @type {number} */ index) =>
      filtered(filters().filter((_, i) => i !== index)),
    clearFilters: () => (filters().length ? filtered([]) : undefined),
  };
}
