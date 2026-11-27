// Where the grid's order and find run: in the frame for a result of up to 10,000 rows, else in the
// grid's worker (worker.js), started with the SDK's startWorker the first time a large result needs
// it. The worker is sent each column it needs once per result set, never the rows; edited and added
// cells go with each request. Without a worker (the unit tests, a frame that cannot start one) the
// same functions run in the frame. Answers in the frame come back as they are, the worker's as a
// promise; the grid draws only the answer to its latest question.

import { valueAt } from "../grid-model.js";
import { t } from "../strings/index.js";
import { findMatches, orderRows } from "./rows.js";

/**
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {import("../edit/pending.js").Changes} Changes
 * @typedef {(url: URL, options?: { name?: string }) => Worker} StartWorker
 * @typedef {Omit<import("./rows.js").OrderInput, "value" | "count">} OrderAsk
 * @typedef {Omit<import("./rows.js").FindInput, "value">} FindAsk
 * @typedef {{ matches: Int32Array, count: number }} Found
 */

export const LARGE = 10_000;

/**
 * @param {StartWorker | undefined} startWorker
 * @param {number} [threshold] Rows past which the worker answers.
 */
export function createRowsClient(startWorker, threshold = LARGE) {
  /** @type {Worker | undefined} */
  let worker;
  let next = 0;
  /** @type {Map<number, { resolve(value: any): void, reject(error: unknown): void }>} */
  const pending = new Map();
  /** @type {WeakMap<ResultSet, string>} */
  const ids = new WeakMap();
  /** The set the worker holds columns of, and which. */
  let held = { result: "", sent: /** @type {Set<number>} */ (new Set()) };

  const started = () => {
    if (worker || !startWorker) return worker;
    try {
      worker = startWorker(new URL("./worker.js", import.meta.url), { name: "Database grid" });
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
      for (const entry of pending.values())
        entry.reject(new Error(t("grid.rowsClient.theGridSWorkerStopped")));
      pending.clear();
      worker = undefined;
      held = { result: "", sent: new Set() };
    };
    return worker;
  };

  /** The worker's id of a result set. */
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
        for (let col = 0; col < set.columns.length; col++)
          overrides.push([
            set.rows.length + i,
            col,
            valueAt(set, changes, set.rows.length + i, col).value,
          ]);
      });
    }
    const id = ++next;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      to.postMessage({ id, result, data, overrides, ...request });
    });
  };

  const value =
    (/** @type {ResultSet} */ set, /** @type {Changes | null} */ changes) =>
    (/** @type {number} */ row, /** @type {number} */ col) =>
      valueAt(set, changes, row, col).value;

  return {
    /**
     * The result rows kept, in order (without the added rows).
     * @param {ResultSet} set @param {Changes | null} changes @param {OrderAsk} input
     * @returns {number[] | Promise<number[]>}
     */
    order(set, changes, input) {
      const to = set.rows.length > threshold ? started() : undefined;
      const busy = input.sort.length > 0 || input.filters.length > 0 || input.text.trim() !== "";
      if (!to || !busy)
        return orderRows({ ...input, count: set.rows.length, value: value(set, changes) });
      const columns = [
        ...input.sort.map((s) => s.column),
        ...input.filters.map((f) => f.column),
        ...(input.text.trim() ? input.search : []),
      ];
      return ask(to, set, changes, columns, {
        kind: "order",
        count: set.rows.length,
        ...input,
      }).then((reply) => Array.from(/** @type {{ order: Int32Array }} */ (reply).order));
    },
    /**
     * Where a text is among the cells on screen.
     * @param {ResultSet} set @param {Changes | null} changes @param {FindAsk} input
     * @returns {Found | Promise<Found>}
     */
    find(set, changes, input) {
      const to = set.rows.length > threshold ? started() : undefined;
      if (!to) return findMatches({ ...input, value: value(set, changes) });
      const order = Int32Array.from(input.order);
      return ask(to, set, changes, input.search, { kind: "find", ...input, order }).then(
        (reply) => /** @type {Found} */ (reply),
      );
    },
  };
}
