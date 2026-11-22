// Two results compared (PG-26, ADR 0329): their rows paired by a key (the primary key, or columns
// the person picked) or, without one, by row position; each pair the same or changed in the cells
// it names, a row only the result after has added, one only the result before has removed. Columns
// are matched by name (a repeated name by its occurrence, grid/columns.js), and a column only one
// side has is listed and not compared. A repeated key pairs its rows in order. The counts are exact;
// the rows kept stop at `keep`, and a comparison takes at most MAX_CELLS cells a side. Runs in the
// comparison's worker (worker.js) or, small, in place (client.js). Only relative imports. No DOM.

import { columnKeys } from "../grid/columns.js";

/**
 * @typedef {{ columns: string[], rows: (string | null)[][] }} Side
 * @typedef {"added" | "removed" | "changed"} Change
 * @typedef {{ change: Change, at: string, before: (string | null)[] | null, after: (string | null)[] | null, cells: number[] }} DiffRow
 *   `at` is the row's key values (or its row number, by position); `before` and `after` its values
 *   in the difference's columns (`common`, then `onlyBefore`, then `onlyAfter`); `cells` the
 *   indexes in `common` of the cells that changed.
 * @typedef {{
 *   by: "key" | "position", key: string[], common: string[], onlyBefore: string[], onlyAfter: string[],
 *   counts: { added: number, removed: number, changed: number, same: number },
 *   repeated: number, total: number, rows: DiffRow[],
 * }} Difference
 *   `repeated` counts the rows whose key an earlier row of the same result has; `total` every
 *   difference, of which `rows` holds the first.
 */

export const MAX_CELLS = 2_000_000;
export const KEEP = 1_000;
export const CHANGE = {
  added: "added",
  removed: "removed",
  before: "changed (before)",
  after: "changed (after)",
};

const count = (/** @type {number} */ n) => n.toLocaleString("en-US");

/** Why a comparison is refused for its size, or "" when it is not. */
export function tooLarge(
  /** @type {Side} */ before,
  /** @type {Side} */ after,
  /** @type {number} */ max = MAX_CELLS,
) {
  for (const [name, side] of /** @type {const} */ ([
    ["before", before],
    ["after", after],
  ])) {
    const cells = side.rows.length * side.columns.length;
    if (cells > max)
      return `Too large to compare: the result ${name} has ${count(cells)} cells (${count(side.rows.length)} rows of ${count(side.columns.length)} columns), and a comparison takes at most ${count(max)} cells a side. Narrow both queries to fewer rows or columns and compare again.`;
  }
  return "";
}

/** A row's key values as one text, NULL apart from every text. */
const keyText = (/** @type {(string | null)[]} */ row, /** @type {number[]} */ at) =>
  JSON.stringify(at.map((i) => row[i] ?? null));
const shown = (/** @type {(string | null)[]} */ row, /** @type {number[]} */ at) =>
  at.map((i) => row[i] ?? "NULL").join(", ");

/**
 * @param {Side} before
 * @param {Side} after
 * @param {string[] | null} key Column names both results have; none (or null) pairs by position.
 * @param {{ keep?: number }} [options]
 * @returns {Difference}
 */
export function compareSets(before, after, key, { keep = KEEP } = {}) {
  const was = columnKeys(before.columns);
  const now = columnKeys(after.columns);
  const common = now.filter((name) => was.includes(name));
  const onlyBefore = was.filter((name) => !now.includes(name));
  const onlyAfter = now.filter((name) => !was.includes(name));
  const keyed = (key ?? []).length > 0;
  for (const name of key ?? [])
    if (!common.includes(name)) throw new Error(`The key ${name} is not a column of both results.`);
  // Where each difference column is in each result (-1: not there).
  const union = [...common, ...onlyBefore, ...onlyAfter];
  const fromBefore = union.map((name) => was.indexOf(name));
  const fromAfter = union.map((name) => now.indexOf(name));
  const pairs = common.map((name) => [was.indexOf(name), now.indexOf(name)]);
  const keyBefore = (key ?? []).map((name) => was.indexOf(name));
  const keyAfter = (key ?? []).map((name) => now.indexOf(name));
  const counts = { added: 0, removed: 0, changed: 0, same: 0 };
  /** @type {DiffRow[]} */
  const rows = [];
  const values = (/** @type {(string | null)[]} */ row, /** @type {number[]} */ from) =>
    from.map((i) => (i < 0 ? null : (row[i] ?? null)));
  const add = (
    /** @type {Change} */ change,
    /** @type {string} */ at,
    /** @type {(string | null)[] | undefined} */ was_,
    /** @type {(string | null)[] | undefined} */ now_,
    /** @type {number[]} */ cells,
  ) => {
    counts[change]++;
    if (rows.length < keep)
      rows.push({
        change,
        at,
        before: was_ ? values(was_, fromBefore) : null,
        after: now_ ? values(now_, fromAfter) : null,
        cells,
      });
  };
  /** One pair of rows: the same, or changed in the cells that differ. */
  const pair = (
    /** @type {(string | null)[]} */ b,
    /** @type {(string | null)[]} */ a,
    /** @type {string} */ at,
  ) => {
    /** @type {number[]} */
    const cells = [];
    pairs.forEach(([x = 0, y = 0], c) => {
      if ((b[x] ?? null) !== (a[y] ?? null)) cells.push(c);
    });
    if (cells.length) add("changed", at, b, a, cells);
    else counts.same++;
  };

  let repeated = 0;
  if (keyed) {
    /** @type {Map<string, number[]>} */
    const waiting = new Map();
    before.rows.forEach((row, i) => {
      const k = keyText(row, keyBefore);
      const queue = waiting.get(k);
      if (queue) {
        queue.push(i);
        repeated++;
      } else waiting.set(k, [i]);
    });
    const paired = new Uint8Array(before.rows.length);
    const seen = new Set();
    for (const row of after.rows) {
      const k = keyText(row, keyAfter);
      if (seen.has(k)) repeated++;
      else seen.add(k);
      const at = shown(row, keyAfter);
      const i = waiting.get(k)?.shift();
      const match = i === undefined ? undefined : before.rows[i];
      if (i === undefined || !match) add("added", at, undefined, row, []);
      else {
        paired[i] = 1;
        pair(match, row, at);
      }
    }
    before.rows.forEach((row, i) => {
      if (!paired[i]) add("removed", shown(row, keyBefore), row, undefined, []);
    });
  } else {
    const length = Math.max(before.rows.length, after.rows.length);
    for (let i = 0; i < length; i++) {
      const b = before.rows[i];
      const a = after.rows[i];
      const at = String(i + 1);
      if (b && a) pair(b, a, at);
      else if (a) add("added", at, undefined, a, []);
      else if (b) add("removed", at, b, undefined, []);
    }
  }
  return {
    by: keyed ? "key" : "position",
    key: keyed ? [...(key ?? [])] : [],
    common,
    onlyBefore,
    onlyAfter,
    counts,
    repeated,
    total: counts.added + counts.removed + counts.changed,
    rows,
  };
}

/**
 * The difference as a result of its own, for copying and exporting in the plugin's formats: a
 * column `change` (moved aside to `_change` when a result has one), then the difference's columns;
 * a changed row as two rows, before and after.
 * @param {Difference} d
 * @returns {import("../engines/common.js").ResultSet}
 */
export function differenceSet(d) {
  const union = [...d.common, ...d.onlyBefore, ...d.onlyAfter];
  let name = "change";
  while (union.includes(name)) name = `_${name}`;
  /** @type {(string | null)[][]} */
  const rows = [];
  for (const row of d.rows) {
    if (row.change === "changed" && row.before && row.after)
      rows.push([CHANGE.before, ...row.before], [CHANGE.after, ...row.after]);
    else if (row.after) rows.push([CHANGE.added, ...row.after]);
    else if (row.before) rows.push([CHANGE.removed, ...row.before]);
  }
  return { columns: [name, ...union], rows, truncated: d.rows.length < d.total };
}
