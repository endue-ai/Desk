// Where the person was in each open file, as the view keeps it (how the file is shown, which nodes
// are open, which is selected), read for a sleep to keep and given back when the file comes back
// (keep.js, ADR 0176). A file above 1 MiB keeps its open nodes in the worker: it comes back with its
// mode and its selected node, opened down to it.

/**
 * @typedef {import("./keep.js").Mode} Mode
 * @typedef {import("./keep.js").Where} Where
 * @typedef {import("./tree-view.js").TreeState & { mode: Mode }} State
 */

/**
 * @param {Map<string, State>} states the view's, per buffer
 * @param {{ shown(): { buffer: string, remote: boolean } | null,
 *   selected(): { key: string } | undefined, reveal(path: number[]): unknown }} tree
 */
export function createPlaces(states, tree) {
  /** Selected nodes of files above 1 MiB, to open down to once each is shown. */
  /** @type {Map<string, string>} */
  const pending = new Map();

  return {
    /**
     * @param {string} buffer
     * @returns {Where | undefined}
     */
    where(buffer) {
      const state = states.get(buffer);
      if (!state) return undefined;
      const on = tree.shown();
      const live = on?.buffer === buffer && on.remote ? tree.selected()?.key : undefined;
      return { mode: state.mode, expanded: [...state.expanded], selected: live ?? state.selected };
    },
    /**
     * @param {string} buffer
     * @param {Partial<Where>} where
     */
    restore(buffer, { mode = "both", expanded = [], selected = null }) {
      states.set(buffer, { expanded: new Set(expanded), selected, mode });
      if (selected) pending.set(buffer, selected);
      else pending.delete(buffer);
    },
    /** The file of `buffer` is shown: one above 1 MiB opens down to the node it was left on. */
    shown(/** @type {string} */ buffer, /** @type {boolean} */ remote) {
      const key = pending.get(buffer);
      pending.delete(buffer);
      if (remote && key) return tree.reveal(key.split("/").map(Number));
    },
  };
}
