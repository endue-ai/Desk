// Where totals and charts are counted (PG-44): in the frame for up to 20,000 cells, else in the
// chart's worker (worker.js), started with the SDK's startWorker the first time a large one needs it.
// The worker is sent each column it needs once per result set; a selection's edited and added cells
// go with each request. Without a worker (the unit tests, a frame that cannot start one) the same
// engine answers in the frame. Answers in the frame come back as they are, the worker's as a promise.

import { valueAt } from "../grid-model.js";
import { groupChart, totalsOf } from "./aggregate.js";

/**
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {import("../edit/pending.js").Changes} Changes
 * @typedef {import("./aggregate.js").Totals} Totals
 * @typedef {import("./aggregate.js").ChartData} ChartData
 * @typedef {import("./aggregate.js").Settings} Settings
 * @typedef {(url: URL, options?: { name?: string }) => Worker} StartWorker
 */

export const LARGE = 20_000;

/**
 * @param {StartWorker | undefined} startWorker
 * @param {number} [threshold] Cells past which the worker counts.
 */
export function createChartClient(startWorker, threshold = LARGE) {
  /** @type {Worker | undefined} */
  let worker;
  let next = 0;
  /** @type {Map<number, { resolve(value: any): void, reject(error: unknown): void }>} */
  const pending = new Map();
  /** @type {WeakMap<ResultSet, string>} */
  const ids = new WeakMap();
  let held = { result: "", sent: /** @type {Set<number>} */ (new Set()) };

  const started = () => {
    if (worker || !startWorker) return worker;
    try {
      worker = startWorker(new URL("./worker.js", import.meta.url), { name: "Database chart" });
    } catch {
      return undefined;
    }
    worker.onmessage = ({ data }) => {
      const entry = pending.get(data.id);
      pending.delete(data.id);
      if (!entry) return;
      if ("error" in data) entry.reject(new Error(data.error));
      else entry.resolve(data);
    };
    worker.onerror = () => {
      for (const entry of pending.values()) entry.reject(new Error("The chart's worker stopped."));
      pending.clear();
      worker = undefined;
      held = { result: "", sent: new Set() };
    };
    return worker;
  };

  const idOf = (/** @type {ResultSet} */ set) => {
    let id = ids.get(set);
    if (!id) {
      id = `set-${++next}`;
      ids.set(set, id);
    }
    return id;
  };

  /** Ask the worker, sending the columns it lacks and the cells that changed. */
  const ask = (
    /** @type {Worker} */ to,
    /** @type {ResultSet} */ set,
    /** @type {Changes | null} */ changes,
    /** @type {number[]} */ columns,
    /** @type {Record<string, unknown>} */ request,
  ) => {
    const result = idOf(set);
    if (held.result !== result) held = { result, sent: new Set() };
    /** @type {Record<number, (string | null)[]>} */
    const data = {};
    for (const col of columns)
      if (!held.sent.has(col)) {
        data[col] = set.rows.map((row) => row[col] ?? null);
        held.sent.add(col);
      }
    /** @type {[number, number, string | null][]} */
    const overrides = [];
    if (changes) {
      for (const [row, cells] of changes.updates)
        for (const col of cells.keys())
          overrides.push([row, col, valueAt(set, changes, row, col).value]);
      changes.inserts.forEach((_, i) => {
        const row = set.rows.length + i;
        for (const col of columns)
          overrides.push([row, col, valueAt(set, changes, row, col).value]);
      });
    }
    const id = ++next;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      to.postMessage({ id, result, data, overrides, ...request });
    });
  };

  return {
    /**
     * The totals of a selection: result rows (pending changes in) by result columns.
     * @param {ResultSet} set @param {Changes | null} changes
     * @param {ArrayLike<number>} rows @param {number[]} columns
     * @returns {Totals | Promise<Totals>}
     */
    totals(set, changes, rows, columns) {
      const to = rows.length * columns.length > threshold ? started() : undefined;
      if (to)
        return ask(to, set, changes, columns, {
          kind: "totals",
          rows: Int32Array.from(rows),
          columns,
        }).then((reply) => reply.totals);
      const values = function* () {
        for (const col of columns)
          for (let i = 0; i < rows.length; i++)
            yield valueAt(set, changes, rows[i] ?? 0, col).value;
      };
      return totalsOf(values());
    },
    /**
     * A chart's data from a result as it was fetched.
     * @param {ResultSet} set @param {Settings} settings
     * @returns {ChartData | Promise<ChartData>}
     */
    chart(set, settings) {
      const used = [settings.x, settings.y, settings.series]
        .map((name) => (name ? set.columns.indexOf(name) : -1))
        .filter((c) => c >= 0);
      const to = set.rows.length * used.length > threshold ? started() : undefined;
      const count = set.rows.length;
      if (to)
        return ask(to, set, null, used, {
          kind: "chart",
          count,
          columns: set.columns,
          settings,
        }).then((reply) => reply.chart);
      const value = (/** @type {number} */ row, /** @type {number} */ col) =>
        set.rows[row]?.[col] ?? null;
      return groupChart({ count, value, columns: set.columns, settings });
    },
  };
}

/** @type {WeakMap<StartWorker, ReturnType<typeof createChartClient>>} */
const shared = new WeakMap();
/** @type {ReturnType<typeof createChartClient> | undefined} */
let inFrame;

/** The page's one client for a worker starter (one for the frame when there is none). */
export function chartClient(/** @type {StartWorker | undefined} */ startWorker) {
  if (!startWorker) {
    inFrame ??= createChartClient(undefined);
    return inFrame;
  }
  let client = shared.get(startWorker);
  if (!client) {
    client = createChartClient(startWorker);
    shared.set(startWorker, client);
  }
  return client;
}
