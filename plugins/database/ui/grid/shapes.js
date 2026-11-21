// What shapes each result in the grid, by the grid's key: its columns (columns.js), and for a
// console's result its sort keys and quick filters. A table view's key (`table:...`) keeps its
// columns through the controller's store a moment after each change and reads them back the first
// time it shows (ADR 0288); a console's result (`result:...`) keeps them while the last 20 results
// are remembered, never across a restart. A table view's sort and filters are the server's
// (pages.js), not kept here. No DOM.

import { emptyColumns, readColumns } from "./columns.js";

/**
 * @typedef {import("./columns.js").ColumnState} ColumnState
 * @typedef {import("./filters.js").Filter} Filter
 * @typedef {import("./filters.js").SortKey} SortKey
 * @typedef {{ key: string, columns: ColumnState, sort: SortKey[], filters: Filter[] }} Shape
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const REMEMBERED = 20;
const KEEP_AFTER_MS = 300;

/**
 * @param {Act} act `columnsLoad(key)` answers a kept state (or nothing), `columnsKeep(key, state)` keeps one.
 * @param {(key: string) => void} loaded Called when a kept state arrives for a key.
 */
export function createShapes(act, loaded) {
  /** @type {Map<string, Shape>} */
  const shapes = new Map();
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const timers = new Map();
  const isTable = (/** @type {string} */ key) => key.startsWith("table:");

  /** The shape of a key, made (and, for a table, asked for) the first time. */
  const of = (/** @type {string} */ key) => {
    const found = shapes.get(key);
    if (found) {
      // The newest last, so the oldest result goes first.
      shapes.delete(key);
      shapes.set(key, found);
      return found;
    }
    /** @type {Shape} */
    const shape = { key, columns: emptyColumns(), sort: [], filters: [] };
    shapes.set(key, shape);
    for (const old of shapes.keys())
      if (shapes.size > REMEMBERED && !isTable(old) && old !== key) shapes.delete(old);
    if (isTable(key)) {
      const asked = act("columnsLoad", key);
      void Promise.resolve(asked).then((kept) => {
        if (kept === undefined || shapes.get(key) !== shape) return;
        shape.columns = readColumns({ v: 1, .../** @type {object} */ (kept) });
        loaded(key);
      });
    }
    return shape;
  };

  /** A shape's columns changed: a table view keeps them a moment later. */
  const columnsChanged = (/** @type {Shape} */ shape, /** @type {ColumnState} */ next) => {
    shape.columns = next;
    if (!isTable(shape.key)) return;
    clearTimeout(timers.get(shape.key));
    timers.set(
      shape.key,
      setTimeout(() => {
        timers.delete(shape.key);
        act("columnsKeep", shape.key, shape.columns);
      }, KEEP_AFTER_MS),
    );
  };

  return { of, columnsChanged };
}
