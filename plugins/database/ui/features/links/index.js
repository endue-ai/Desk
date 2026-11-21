// Foreign keys followed from the grid (PG-41, ADR 0322): Database: go to the row this key points at
// (`g`, Mod+click), Database: show the rows that point at this row (`r`, counted on request),
// Database: go back (`b`) and Database: pick the key from the referenced table (Enter on a key
// cell), each on the grid's cursor in the result on screen. `linksLoad` answers the grid which of
// its columns link (links/grid-links.js). Links are the catalog's declared constraints, read from
// the schema cache or pg_constraint (read.js); PostgreSQL only. No DOM.

import { createTrail, linkColumns, linkTitle } from "../../links/model.js";
import { back, follow, referencing } from "./follow.js";
import { pickKey } from "./pick.js";
import { onScreen, readKeys } from "./read.js";

/** @typedef {import("../../feature-host.js").Deps} Deps */

/** Which result columns of the result on screen link, and whether keys point at its table. */
async function linksOf(/** @type {Deps} */ deps) {
  try {
    const here = onScreen(deps);
    const keys = await readKeys(deps, here.conn, here.source, true);
    const by = linkColumns(keys.outgoing, here.set.columns);
    return {
      columns: [...by].sort(([a], [b]) => a - b).map(([col, k]) => ({ col, title: linkTitle(k) })),
      referenced: keys.incoming.length > 0,
    };
  } catch {
    return undefined;
  }
}

/** The trail back of a mount of the plugin: its commands and its keys walk the same one. */
/** @type {WeakMap<Deps, ReturnType<typeof createTrail>>} */
const trails = new WeakMap();
const trailOf = (/** @type {Deps} */ deps) => {
  const kept = trails.get(deps);
  if (kept) return kept;
  const trail = createTrail();
  trails.set(deps, trail);
  return trail;
};

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "links",
  commands: (deps) => ({
    "endue.database.follow-key": (args) => follow(deps, trailOf(deps), args),
    "endue.database.referencing-rows": (args) => referencing(deps, trailOf(deps), args),
    "endue.database.go-back": () => back(deps, trailOf(deps)),
    "endue.database.pick-key": (args) => pickKey(deps, args),
  }),
  actions: (deps) => ({
    linksLoad: () => linksOf(deps),
    followKey: () => follow(deps, trailOf(deps), {}),
    referencingRows: () => referencing(deps, trailOf(deps), {}),
    goBack: () => back(deps, trailOf(deps)),
    pickKey: () => pickKey(deps, {}),
  }),
  styles: [new URL("./links.css", import.meta.url).href],
};
