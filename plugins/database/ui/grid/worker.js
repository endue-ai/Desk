// The grid's worker, started with the SDK's startWorker (rows-client.js) once a result is large: it
// orders and searches a result's rows over the columns it was sent, so a sort, a quick filter or a
// find over 100,000 rows never holds the frame's thread. Each column comes once per result (`data`);
// edited and added cells come with each request (`overrides`). Only relative imports: import maps do
// not reach a module worker.

import { findMatches, orderRows } from "./rows.js";

/**
 * @typedef {import("./rows.js").SortBy} SortBy
 * @typedef {import("./rows.js").FilterBy} FilterBy
 * @typedef {[number, number, string | null][]} Overrides row, column, value
 * @typedef {{ id: number, result: string, data?: Record<number, (string | null)[]>, overrides?: Overrides }} Common
 * @typedef {Common & { kind: "order", count: number, numeric: boolean[], sort: SortBy[], filters: FilterBy[], text: string, search: number[] }} OrderRequest
 * @typedef {Common & { kind: "find", order: ArrayLike<number>, search: number[], needle: string, matchCase: boolean, whole: boolean, limit: number }} FindRequest
 * @typedef {{ id: number, order: Int32Array } | { id: number, matches: Int32Array, count: number } | { id: number, error: string }} Reply
 */

/** The result the columns are of, and its columns by index. */
let held = { result: "", columns: /** @type {Map<number, (string | null)[]>} */ (new Map()) };

/** The columns a request reads. */
function needed(/** @type {OrderRequest | FindRequest} */ request) {
  if (request.kind === "find") return request.search;
  const columns = [...request.sort.map((s) => s.column), ...request.filters.map((f) => f.column)];
  return request.text.trim() ? [...columns, ...request.search] : columns;
}

/** @param {OrderRequest | FindRequest} request @returns {Reply} */
export function answer(request) {
  const { id } = request;
  if (held.result !== request.result) held = { result: request.result, columns: new Map() };
  for (const [col, values] of Object.entries(request.data ?? {}))
    held.columns.set(Number(col), values);
  for (const col of needed(request))
    if (!held.columns.has(col))
      return { id, error: `The grid's worker has no column ${col} of this result.` };
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
  if (request.kind === "order")
    return { id, order: Int32Array.from(orderRows({ ...request, value })) };
  return { id, ...findMatches({ ...request, value }) };
}

if (typeof globalThis.postMessage === "function" && typeof document === "undefined") {
  globalThis.onmessage = (event) => {
    const reply = answer(event.data);
    const buffer =
      "order" in reply ? reply.order.buffer : "matches" in reply ? reply.matches.buffer : null;
    globalThis.postMessage(reply, { transfer: buffer ? [buffer] : [] });
  };
}
