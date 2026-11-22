// What the chart's worker answers (PG-44, worker.js), and the frame too when it has none: a
// selection's totals and a chart's groups over the columns of one result, each column sent once per
// result (`data`), edited and added cells with each request (`overrides`). Only relative imports:
// import maps do not reach a module worker.

import { groupChart, totalsOf } from "./aggregate.js";

/**
 * @typedef {[number, number, string | null][]} Overrides row, column, value
 * @typedef {{ id: number, result: string, data?: Record<number, (string | null)[]>, overrides?: Overrides }} Common
 * @typedef {Common & { kind: "totals", rows: ArrayLike<number>, columns: number[] }} TotalsRequest
 * @typedef {Common & { kind: "chart", count: number, columns: string[], settings: import("./aggregate.js").Settings }} ChartRequest
 * @typedef {TotalsRequest | ChartRequest} Request
 * @typedef {{ id: number, totals: import("./aggregate.js").Totals } | { id: number, chart: import("./aggregate.js").ChartData } | { id: number, error: string }} Reply
 */

export function createChartEngine() {
  /** The result the columns are of, and its columns by index. */
  let held = { result: "", columns: /** @type {Map<number, (string | null)[]>} */ (new Map()) };

  /** @param {Request} request @returns {Reply} */
  const answer = (request) => {
    const { id } = request;
    if (held.result !== request.result) held = { result: request.result, columns: new Map() };
    for (const [col, values] of Object.entries(request.data ?? {}))
      held.columns.set(Number(col), values);
    /** @type {Map<number, Map<number, string | null>>} */
    const changed = new Map();
    for (const [row, col, value] of request.overrides ?? []) {
      const cells = changed.get(row) ?? new Map();
      cells.set(col, value);
      changed.set(row, cells);
    }
    const { columns } = held;
    const value = (/** @type {number} */ row, /** @type {number} */ col) => {
      const cells = changed.get(row);
      if (cells?.has(col)) return cells.get(col) ?? null;
      return columns.get(col)?.[row] ?? null;
    };
    if (request.kind === "totals") {
      const { rows, columns: cols } = request;
      for (const col of cols)
        if (!columns.has(col)) return { id, error: `The chart's worker has no column ${col}.` };
      const values = function* () {
        for (const col of cols) for (let i = 0; i < rows.length; i++) yield value(rows[i] ?? 0, col);
      };
      return { id, totals: totalsOf(values()) };
    }
    const { count, columns: names, settings } = request;
    return { id, chart: groupChart({ count, value, columns: names, settings }) };
  };
  return { answer };
}
