// Values set while running: what scripts set and what responses' captures read. They are kept per
// collection, so a request of one collection, or a capture in it (data from its files, which runs
// unasked), can never change what another collection's requests fill in: a capture of `baseUrl`
// in a cloned collection does not send your own collection's token elsewhere. Requests outside any
// collection (new ones, copies, the history) share a scope of their own.

import { scope } from "./vars.js";

/** @typedef {import("./app.js").Tab} Tab @typedef {import("./vars.js").Scope} Scope */

export function createRuntime() {
  /** Values of requests outside any collection. */
  const loose = scope("runtime", "Runtime", {});
  /** @type {Map<string, Scope>} collection path → its values */
  const byCollection = new Map();
  /** The scope a tab's runtime values live in. @param {Tab} tab @returns {Scope} */
  const of = (tab) => {
    const path = tab.ref?.collection;
    if (!path) return loose;
    let found = byCollection.get(path);
    if (!found) {
      found = scope("runtime", "Runtime", {});
      byCollection.set(path, found);
    }
    return found;
  };
  return {
    loose,
    of,
    /** @param {Tab} tab @param {string} name @param {string} value */
    set: (tab, name, value) => of(tab).values.set(name, value),
    clear: () => {
      loose.values.clear();
      byCollection.clear();
    },
  };
}
