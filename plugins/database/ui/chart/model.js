// A chart's settings (PG-44): its type, the X column, the Y column (none counts rows), a series
// column (none draws one) and how a group is aggregated, columns by name so the settings kept with
// a starred query fit its next run. The defaults read the result: X is its first column of text,
// Y its first of numbers, summed. No DOM.

import { parseDecimal } from "./decimal.js";

/**
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {import("./aggregate.js").Settings} Settings
 * @typedef {{ set: ResultSet, settings?: Settings }} ChartTab
 *   What a Chart tab (tabs.js) holds: the result it draws, as it was fetched, and how.
 */

export const TYPES = /** @type {const} */ (["bar", "line", "area", "scatter", "pie"]);
export const AGGREGATES = /** @type {const} */ (["sum", "avg", "count", "min", "max"]);
export const TYPE_NAMES = {
  bar: "Bar",
  line: "Line",
  area: "Area",
  scatter: "Scatter",
  pie: "Pie",
};
export const AGGREGATE_NAMES = {
  sum: "sum",
  avg: "average",
  count: "count",
  min: "minimum",
  max: "maximum",
};
/** Rows read to tell a column of numbers. */
const SAMPLE = 2000;

/** Whether each column's values that are not NULL read as numbers, over the first rows. */
export function numberColumns(/** @type {ResultSet} */ set) {
  return set.columns.map((_, c) => {
    let seen = false;
    for (const row of set.rows.slice(0, SAMPLE)) {
      const value = row[c] ?? null;
      if (value === null) continue;
      if (!parseDecimal(value)) return false;
      seen = true;
    }
    return seen;
  });
}

/**
 * A result's chart settings: `given` over the defaults, every column checked.
 * @param {ResultSet} set
 * @param {Partial<Record<keyof Settings, unknown>>} [given]
 * @returns {Settings}
 */
export function settingsFor(set, given = {}) {
  const numeric = numberColumns(set);
  const text = set.columns.findIndex((_, c) => !numeric[c]);
  const x = set.columns[Math.max(text, 0)] ?? "";
  const y = set.columns.find((name, c) => numeric[c] && name !== x) ?? "";
  /** @type {Settings} */
  const base = { type: "bar", x, y, series: "", aggregate: y ? "sum" : "count" };
  const column = (/** @type {"x" | "y" | "series"} */ key) => {
    const value = given[key];
    if (value === undefined) return base[key];
    const name = String(value);
    if (name && !set.columns.includes(name)) throw new Error(`The result has no column ${name}.`);
    if (!name && key === "x") throw new Error("A chart needs an X column.");
    return name;
  };
  const type = given.type === undefined ? base.type : String(given.type);
  if (!TYPES.includes(/** @type {never} */ (type)))
    throw new Error(`A chart is ${TYPES.join(", ")}: not ${type}.`);
  const aggregate = given.aggregate === undefined ? base.aggregate : String(given.aggregate);
  if (!AGGREGATES.includes(/** @type {never} */ (aggregate)))
    throw new Error(`A chart's aggregate is ${AGGREGATES.join(", ")}: not ${aggregate}.`);
  return {
    type: /** @type {Settings["type"]} */ (type),
    x: column("x"),
    y: column("y"),
    series: column("series"),
    aggregate: /** @type {Settings["aggregate"]} */ (aggregate),
  };
}

/** What a chart draws, in words: its type, what is aggregated and by what. */
export function chartTitle(/** @type {Settings} */ s) {
  const type = `${TYPE_NAMES[s.type]} chart`;
  if (s.type === "scatter") return `${type} of ${s.y || "rows"} against ${s.x}`;
  const what = s.y ? `the ${AGGREGATE_NAMES[s.aggregate]} of ${s.y}` : "the count of rows";
  const split = s.series && s.type !== "pie" ? `, split by ${s.series}` : "";
  return `${type} of ${what} by ${s.x}${split}`;
}
