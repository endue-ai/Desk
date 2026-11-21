// Undo of the pending changes (PG-43, ADR 0115): each step (a cell, a paste, a duplicate, a fill, a
// clear, rows added, deleted or reverted) keeps a copy of the changes before it, so one undo takes
// back one step whole. A step that changed nothing keeps nothing; one that throws is put back. The
// changes object stays the same one (the grid reads it from the edit state); only its parts are
// replaced. The steps are a plain array the edit state holds (edits.js), changed in place: 100 are
// kept, fewer when together they hold more than a million cells (a big paste is a big step). Pure.

/** @typedef {import("./pending.js").Changes} Changes */

export const HISTORY = 100;
const CELLS = 1_000_000;

/** How many cells a set of changes holds. */
const sizeOf = (/** @type {Changes} */ changes) =>
  [...changes.updates.values()].reduce((sum, cells) => sum + cells.size, 0) +
  changes.inserts.reduce((sum, values) => sum + values.length, 0) +
  changes.deletes.size;

/** A copy of the changes that later edits do not reach. @returns {Changes} */
export function snapshot(/** @type {Changes} */ changes) {
  return {
    updates: new Map([...changes.updates].map(([row, cells]) => [row, new Map(cells)])),
    inserts: changes.inserts.map((values) => [...values]),
    deletes: new Set(changes.deletes),
  };
}

/** Whether two sets of changes hold the same. */
export function sameChanges(/** @type {Changes} */ a, /** @type {Changes} */ b) {
  if (a.updates.size !== b.updates.size || a.deletes.size !== b.deletes.size) return false;
  if (a.inserts.length !== b.inserts.length) return false;
  for (const row of a.deletes) if (!b.deletes.has(row)) return false;
  for (const [row, cells] of a.updates) {
    const other = b.updates.get(row);
    if (!other || other.size !== cells.size) return false;
    for (const [col, value] of cells) if (!other.has(col) || other.get(col) !== value) return false;
  }
  return a.inserts.every((values, i) => {
    const other = b.inserts[i] ?? [];
    return values.length === other.length && values.every((v, c) => v === other[c]);
  });
}

/** Put `from`'s parts into `into`, which stays the same object. */
function restore(/** @type {Changes} */ into, /** @type {Changes} */ from) {
  into.updates = from.updates;
  into.inserts = from.inserts;
  into.deletes = from.deletes;
  return into;
}

/**
 * @param {Changes[]} [steps] The steps kept so far, changed in place.
 * @param {number} [limit]
 */
export function createHistory(steps = [], limit = HISTORY) {
  return {
    /**
     * Run one step on `changes`: kept when it changed them, put back when it throws.
     * @param {Changes} changes
     * @param {() => unknown} step
     */
    record(changes, step) {
      const before = snapshot(changes);
      try {
        step();
      } catch (error) {
        restore(changes, before);
        throw error;
      }
      if (!sameChanges(before, changes)) {
        steps.push(before);
        if (steps.length > limit) steps.splice(0, steps.length - limit);
        let held = steps.reduce((sum, step) => sum + sizeOf(step), 0);
        while (steps.length > 1 && held > CELLS)
          held -= sizeOf(/** @type {Changes} */ (steps.shift()));
      }
      return changes;
    },
    /** Take back the last step; undefined when there is none. */
    undo(/** @type {Changes} */ changes) {
      const last = steps.pop();
      return last ? restore(changes, last) : undefined;
    },
    size: () => steps.length,
    clear() {
      steps.length = 0;
    },
  };
}
