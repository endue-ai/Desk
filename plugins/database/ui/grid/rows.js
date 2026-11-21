// The grid's rows as indexes, never copies: which of a result's rows a set of quick filters and the
// text filter keep, in the order of several sort keys, and where a text is found among the cells on
// screen. It reads values through a function, so the frame (with pending changes in) and the grid's
// worker (over the columns it was sent) share it. Imports nothing: the worker loads it as it is.

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * @typedef {{ column: number, direction: "asc" | "desc" }} SortBy
 * @typedef {"eq" | "ne" | "gt" | "lt" | "contains" | "empty" | "null" | "notNull"} FilterOp
 * @typedef {{ column: number, op: FilterOp, value: string | null }} FilterBy
 * @typedef {(row: number, col: number) => string | null} Value
 * @typedef {{
 *   count: number, value: Value, numeric: boolean[], sort: SortBy[], filters: FilterBy[],
 *   text: string, search: number[],
 * }} OrderInput
 *   `count` rows from 0; `search` the columns the text filter looks in.
 * @typedef {{
 *   order: ArrayLike<number>, search: number[], value: Value, needle: string,
 *   matchCase: boolean, whole: boolean, limit: number,
 * }} FindInput
 *   `order` the rows on screen, `search` the columns on screen, both in screen order.
 */

/** Two values compared: numbers by value in a numeric column, text by the collator. */
function compare(/** @type {string} */ a, /** @type {string} */ b, /** @type {boolean} */ numeric) {
  if (numeric) {
    const x = Number(a);
    const y = Number(b);
    if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
  }
  return collator.compare(a, b);
}

/**
 * Whether a cell holds a quick filter. As in SQL, NULL holds only "is NULL": it is neither equal nor
 * unequal to anything. Equal is exact (numbers by value), contains ignores case.
 * @param {FilterOp} op
 * @param {string | null} cell
 * @param {string | null} value
 * @param {boolean} numeric
 */
export function holds(op, cell, value, numeric) {
  if (op === "null") return cell === null;
  if (op === "notNull") return cell !== null;
  if (cell === null) return false;
  if (op === "empty") return cell === "";
  const wanted = value ?? "";
  if (op === "contains") return cell.toLowerCase().includes(wanted.toLowerCase());
  if (op === "eq" || op === "ne") {
    const same = numeric
      ? cell === wanted || (Number(cell) === Number(wanted) && wanted.trim() !== "")
      : cell === wanted;
    return op === "eq" ? same : !same;
  }
  const by = compare(cell, wanted, numeric);
  return op === "gt" ? by > 0 : by < 0;
}

/**
 * The rows kept, in screen order: every filter holds and a searched column holds the text (NULL as
 * "null"), sorted by each key in turn (NULL last either way), ties in the result's order.
 * @param {OrderInput} input
 * @returns {number[]}
 */
export function orderRows({ count, value, numeric, sort, filters, text, search }) {
  const needle = text.trim().toLowerCase();
  /** @type {number[]} */
  const kept = [];
  for (let r = 0; r < count; r++) {
    let keep = true;
    for (const f of filters)
      if (!holds(f.op, value(r, f.column), f.value, numeric[f.column] ?? false)) {
        keep = false;
        break;
      }
    if (keep && needle)
      keep = search.some((c) => {
        const v = value(r, c);
        return (v === null ? "null" : v.toLowerCase()).includes(needle);
      });
    if (keep) kept.push(r);
  }
  if (sort.length === 0) return kept;
  // Each key's values read once, numbers already numbers, so the sort compares without reading.
  const keys = sort.map(({ column, direction }) => {
    const isNumber = numeric[column] ?? false;
    /** @type {(string | number | null)[]} */
    const values = new Array(count);
    for (const r of kept) {
      const v = value(r, column);
      const n = isNumber && v !== null ? Number(v) : Number.NaN;
      values[r] = v === null ? null : Number.isFinite(n) ? n : v;
    }
    return { values, sign: direction === "asc" ? 1 : -1 };
  });
  kept.sort((a, b) => {
    for (const { values, sign } of keys) {
      const x = values[a] ?? null;
      const y = values[b] ?? null;
      if (x === null || y === null) {
        if (x === y) continue;
        return x === null ? 1 : -1;
      }
      const by =
        typeof x === "number" && typeof y === "number" ? x - y : collator.compare(`${x}`, `${y}`);
      if (by !== 0) return sign * by;
    }
    return a - b;
  });
  return kept;
}

/**
 * Where a text is in the cells on screen: pairs of screen row and screen column, in screen order,
 * the first `limit` of them, and how many there are. NULL is found as "NULL".
 * @param {FindInput} input
 */
export function findMatches({ order, search, value, needle, matchCase, whole, limit }) {
  const wanted = matchCase ? needle : needle.toLowerCase();
  if (!wanted) return { matches: new Int32Array(0), count: 0 };
  /** @type {number[]} */
  const pairs = [];
  let count = 0;
  for (let i = 0; i < order.length; i++) {
    const row = order[i] ?? 0;
    for (let j = 0; j < search.length; j++) {
      const v = value(row, search[j] ?? 0);
      const text = v === null ? "NULL" : matchCase ? v : v.toLowerCase();
      const at = v === null && !matchCase ? "null" : text;
      if (whole ? at === wanted : at.includes(wanted)) {
        count++;
        if (pairs.length < limit * 2) pairs.push(i, j);
      }
    }
  }
  return { matches: Int32Array.from(pairs), count };
}

/**
 * The match to go to from a cell: the next one after it (`step` 1), the one before it (-1), or the
 * first at or after it (0), wrapping at either end; -1 when there is none.
 * @param {Int32Array} matches pairs of screen row and column
 * @param {{ row: number, col: number }} at
 * @param {-1 | 0 | 1} step
 */
export function nextMatch(matches, at, step) {
  const n = matches.length / 2;
  if (n === 0) return -1;
  const order = (/** @type {number} */ i) =>
    Math.sign((matches[2 * i] ?? 0) - at.row || (matches[2 * i + 1] ?? 0) - at.col);
  if (step < 0) {
    for (let i = n - 1; i >= 0; i--) if (order(i) < 0) return i;
    return n - 1;
  }
  for (let i = 0; i < n; i++) if (order(i) > (step === 0 ? -1 : 0)) return i;
  return 0;
}
