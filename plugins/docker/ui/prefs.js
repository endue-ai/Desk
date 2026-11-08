// Each list's search query and sort, set from the toolbar, the keys or a command, and kept in the
// plugin's state so a reload comes back to them.

import { SORTS } from "./query.js";

/** @typedef {import("./query.js").Prefs} Prefs */

/** The lists that have a query and a sort. */
export const QUERIED = Object.freeze(Object.keys(SORTS));

const words = (/** @type {readonly string[]} */ list) =>
  list.length < 2 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} or ${list.at(-1)}`;

/** A list that has a query, checked. */
export function queriedList(/** @type {unknown} */ name) {
  if (typeof name !== "string" || !QUERIED.includes(name))
    throw new Error(`The list ${JSON.stringify(name)} is not ${words(QUERIED)}.`);
  return name;
}

export function createPrefs() {
  /** @type {Record<string, Prefs>} */
  let prefs = {};

  /** @returns {Prefs} */
  const get = (/** @type {string} */ name) =>
    prefs[name] ?? { query: "", sort: { key: SORTS[name]?.[0] ?? "name", desc: false } };

  return {
    get,
    /** @param {string} name @param {unknown} text */
    query(name, text) {
      if (typeof text !== "string" || text.length > 200 || text.includes("\0"))
        throw new Error("The query is text of 200 characters at most.");
      prefs = { ...prefs, [name]: { ...get(name), query: text } };
      return get(name);
    },
    /** @param {string} name @param {unknown} key @param {unknown} desc */
    sort(name, key, desc) {
      const keys = SORTS[name] ?? [];
      if (typeof key !== "string" || !keys.includes(key))
        throw new Error(`Sort the ${name} by ${words(keys)}.`);
      prefs = { ...prefs, [name]: { ...get(name), sort: { key, desc: desc === true } } };
      return get(name);
    },
    /** What a reload hands back; anything malformed is dropped. */
    restore(/** @type {unknown} */ saved) {
      if (typeof saved !== "object" || saved === null) return;
      for (const [name, value] of Object.entries(saved)) {
        const p = /** @type {Partial<Prefs> | undefined} */ (value);
        if (!QUERIED.includes(name) || typeof p?.query !== "string") continue;
        prefs[name] = { query: p.query.slice(0, 200), sort: get(name).sort };
        try {
          if (p.sort) this.sort(name, p.sort.key, p.sort.desc);
        } catch {
          // A sort this version does not offer keeps the default.
        }
      }
    },
    saved: () => prefs,
  };
}
