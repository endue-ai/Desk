// A value searched for across the tables of a schema (PG-81): a panel per connection with a form
// (what to find, how to match, which schemas, tables and kinds of column, the limits), the estimate
// before it starts, the tables read one after another in read-only transactions with a statement
// timeout each, progress and Cancel, and the matches grouped by table and column, each opening the
// table filtered. Commands: Database: search for a value in tables (agents get it read-only, under
// the same limits, and it answers the counts and the first keys) and Database: cancel the value
// search; the explorer's `s` opens it on a connection, schema or table. The panel keeps its options
// across a restart, never its results. controller.js runs it, panel.js and results.js draw.

import { createSearchPanels, TYPE } from "./controller.js";
import { searchPanel } from "./panel.js";

/** One controller per plugin, shared by the feature's commands and actions. */
const controllers = new WeakMap();
const of = (/** @type {import("../../feature-host.js").Deps} */ deps) => {
  let controller = controllers.get(deps);
  if (!controller) {
    controller = createSearchPanels(deps);
    controllers.set(deps, controller);
  }
  return /** @type {ReturnType<typeof createSearchPanels>} */ (controller);
};

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "search",
  commands: (deps) => {
    const search = of(deps);
    return {
      "endue.database.search-data": (args) => search.open(args),
      "endue.database.search-data-cancel": () => search.cancel(undefined),
    };
  },
  actions: (deps) => {
    const search = of(deps);
    return {
      /** The explorer's `s` on a connection, schema or table row. */
      searchData: (/** @type {import("../../explorer.js").Node | undefined} */ node) =>
        search.open({
          ...(node?.connection ? { connection: node.connection } : {}),
          ...(node?.schema !== undefined && node.kind !== "connection"
            ? { schema: node.schema }
            : {}),
          ...(node?.table !== undefined ? { table: node.table } : {}),
        }),
      searchChange: (/** @type {string} */ id, /** @type {Record<string, unknown>} */ fields) =>
        search.change(id, fields),
      searchStart: async (
        /** @type {string} */ id,
        /** @type {Record<string, unknown>} */ fields,
      ) => {
        await search.start(id, fields);
      },
      searchCancel: (/** @type {string} */ id) => search.cancel(id),
      searchOpen: (
        /** @type {string} */ id,
        /** @type {number} */ table,
        /** @type {number} */ column,
        /** @type {number | undefined} */ hit,
      ) => search.openHit(id, table, column, hit),
    };
  },
  panels: {
    [TYPE]: {
      label: "Search for a value",
      render: searchPanel,
      keep: (/** @type {import("./controller.js").SearchState} */ state) => ({
        ...state,
        run: null,
        error: "",
      }),
    },
  },
  styles: [new URL("./search.css", import.meta.url).href],
};
