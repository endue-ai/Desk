// A selection's totals and a chart's groups, on exact decimals (decimal.js, PG-44). Totals: the count
// of values that are not NULL, the NULLs, the distinct values (by number when every value is one),
// and the sum, average, minimum and maximum: of numbers when every value reads as one, else only the
// minimum and maximum of the text. A chart groups rows by its X column and splits them by a series
// column, each group aggregated (sum, avg, count, min, max). Pure, and the worker's too: only
// relative imports.

import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  formatDecimal,
  keyOfDecimal,
  parseDecimal,
} from "./decimal.js";

/**
 * @typedef {import("./decimal.js").Decimal} Decimal
 * @typedef {{ count: number, nulls: number, distinct: number, numeric: boolean, sum: string | null, average: string | null, min: string | null, max: string | null }} Totals
 * @typedef {"bar" | "line" | "area" | "scatter" | "pie"} ChartType
 * @typedef {"sum" | "avg" | "count" | "min" | "max"} Aggregate
 * @typedef {{ type: ChartType, x: string, y: string, series: string, aggregate: Aggregate }} Settings
 *   Columns by name; `y` "" counts rows, `series` "" draws one series.
 * @typedef {{ x: string, y: string, series: number }} Point
 * @typedef {{
 *   categories: string[], series: { name: string, values: (string | null)[] }[], points: Point[],
 *   dropped: { categories: number, series: number, points: number }, skipped: number,
 * }} ChartData
 *   `values[i]` is the aggregate of `categories[i]` (null: no value); `skipped` counts values that
 *   are not numbers, left out of a sum, an average, a minimum or a maximum.
 * @typedef {{ count: number, value(row: number, col: number): string | null, columns: string[], settings: Settings, rows?: ArrayLike<number> }} GroupInput
 */

/** The limits a chart draws to: past them it says what it left out. */
export const LIMITS = { categories: 50, lines: 2000, series: 6, slices: 6, points: 5000 };

/** One running aggregate of values, by number while every value reads as one. */
function accumulator() {
  let count = 0;
  let nulls = 0;
  let numeric = true;
  /** @type {Decimal | null} */
  let sum = null;
  /** @type {{ d: Decimal, text: string } | null} */
  let low = null;
  /** @type {{ d: Decimal, text: string } | null} */
  let high = null;
  /** @type {string | null} */
  let lowText = null;
  /** @type {string | null} */
  let highText = null;
  const byNumber = new Set();
  const byText = new Set();
  return {
    add(/** @type {string | null} */ value) {
      if (value === null) {
        nulls++;
        return;
      }
      count++;
      byText.add(value);
      if (lowText === null || value < lowText) lowText = value;
      if (highText === null || value > highText) highText = value;
      if (!numeric) return;
      const d = parseDecimal(value);
      if (!d) {
        numeric = false;
        byNumber.clear();
        return;
      }
      byNumber.add(keyOfDecimal(d));
      sum = sum ? addDecimal(sum, d) : d;
      if (!low || compareDecimal(d, low.d) < 0) low = { d, text: value };
      if (!high || compareDecimal(d, high.d) > 0) high = { d, text: value };
    },
    /** @returns {Totals} */
    result() {
      const isNumber = numeric && count > 0;
      return {
        count,
        nulls,
        distinct: isNumber ? byNumber.size : byText.size,
        numeric: isNumber,
        sum: isNumber && sum ? formatDecimal(sum) : null,
        average: isNumber && sum ? formatDecimal(divideDecimal(sum, BigInt(count))) : null,
        min: isNumber ? (low?.text ?? null) : lowText,
        max: isNumber ? (high?.text ?? null) : highText,
      };
    },
  };
}

/** The totals of some values. @returns {Totals} */
export function totalsOf(/** @type {Iterable<string | null>} */ values) {
  const acc = accumulator();
  for (const value of values) acc.add(value);
  return acc.result();
}

/** One group's aggregate: numbers only, NULLs left out, a count of what is not NULL. */
function group(/** @type {Aggregate} */ aggregate) {
  let count = 0;
  let skipped = 0;
  /** @type {Decimal | null} */
  let sum = null;
  /** @type {{ d: Decimal, text: string } | null} */
  let pick = null;
  const sign = aggregate === "min" ? -1 : 1;
  return {
    add(/** @type {string | null} */ value) {
      if (value === null) return;
      if (aggregate === "count") {
        count++;
        return;
      }
      const d = parseDecimal(value);
      if (!d) {
        skipped++;
        return;
      }
      count++;
      if (aggregate === "sum" || aggregate === "avg") sum = sum ? addDecimal(sum, d) : d;
      else if (!pick || compareDecimal(d, pick.d) * sign > 0) pick = { d, text: value };
    },
    get skipped() {
      return skipped;
    },
    /** @returns {string | null} */
    value() {
      if (aggregate === "count") return String(count);
      if (count === 0) return null;
      if (aggregate === "sum") return sum ? formatDecimal(sum) : null;
      if (aggregate === "avg") return sum ? formatDecimal(divideDecimal(sum, BigInt(count))) : null;
      return pick?.text ?? null;
    },
  };
}

/** A category's label: its text, NULL apart. */
const labelOf = (/** @type {string | null} */ v) => (v === null ? "NULL" : v);

/** Categories in numeric order when every one but NULL reads as a number, NULL last. */
function ordered(/** @type {string[]} */ keys) {
  const parsed = keys.map((k) => (k === "NULL" ? null : parseDecimal(k)));
  if (parsed.some((d, i) => d === null && keys[i] !== "NULL")) return keys;
  return keys
    .map((k, i) => ({ k, d: parsed[i] ?? null }))
    .sort((a, b) => (!a.d ? 1 : !b.d ? -1 : compareDecimal(a.d, b.d)))
    .map((e) => e.k);
}

/** A chart's data from a result's rows. @param {GroupInput} input @returns {ChartData} */
export function groupChart({ count, value, columns, settings, rows }) {
  const at = (/** @type {string} */ name) => (name ? columns.indexOf(name) : -1);
  const x = at(settings.x);
  const y = at(settings.y);
  const s = settings.type === "pie" ? -1 : at(settings.series);
  const total = rows ? rows.length : count;
  const rowAt = (/** @type {number} */ i) => (rows ? (rows[i] ?? 0) : i);
  const dropped = { categories: 0, series: 0, points: 0 };
  /** @type {Map<string, number>} */
  const seriesAt = new Map();
  const seriesOf = (/** @type {number} */ row) => {
    const name = s < 0 ? (y < 0 ? "rows" : settings.y) : labelOf(value(row, s));
    let index = seriesAt.get(name);
    if (index === undefined && seriesAt.size < LIMITS.series) {
      index = seriesAt.size;
      seriesAt.set(name, index);
    }
    return index;
  };
  const named = () => [...seriesAt.keys()];
  const extra = new Set();
  if (settings.type === "scatter") {
    /** @type {Point[]} */
    const points = [];
    let skipped = 0;
    for (let i = 0; i < total; i++) {
      const row = rowAt(i);
      const px = value(row, x);
      const py = value(row, y);
      if (px === null || py === null) continue;
      if (!parseDecimal(px) || !parseDecimal(py)) {
        skipped++;
        continue;
      }
      const series = seriesOf(row);
      if (series === undefined) extra.add(labelOf(value(row, s)));
      else if (points.length < LIMITS.points) points.push({ x: px, y: py, series });
      else dropped.points++;
    }
    dropped.series = extra.size;
    const series = named().map((name) => ({ name, values: [] }));
    return { categories: [], series, points, dropped, skipped };
  }
  const cap =
    settings.type === "pie"
      ? LIMITS.slices
      : settings.type === "bar"
        ? LIMITS.categories
        : LIMITS.lines;
  /** @type {Map<string, Map<number, ReturnType<typeof group>>>} */
  const groups = new Map();
  const left = new Set();
  const aggregate = y < 0 ? "count" : settings.aggregate;
  for (let i = 0; i < total; i++) {
    const row = rowAt(i);
    const key = labelOf(x < 0 ? null : value(row, x));
    let cells = groups.get(key);
    if (!cells) {
      if (groups.size >= cap) {
        left.add(key);
        continue;
      }
      cells = new Map();
      groups.set(key, cells);
    }
    const series = seriesOf(row);
    if (series === undefined) {
      extra.add(labelOf(value(row, s)));
      continue;
    }
    let cell = cells.get(series);
    if (!cell) {
      cell = group(aggregate);
      cells.set(series, cell);
    }
    cell.add(y < 0 ? "" : value(row, y));
  }
  dropped.categories = left.size;
  dropped.series = extra.size;
  const categories = settings.type === "bar" || settings.type === "pie" ? [...groups.keys()] : ordered([...groups.keys()]);
  let skipped = 0;
  for (const cells of groups.values()) for (const cell of cells.values()) skipped += cell.skipped;
  const series = named().map((name, index) => ({
    name,
    values: categories.map((k) => groups.get(k)?.get(index)?.value() ?? null),
  }));
  return { categories, series, points: [], dropped, skipped };
}
