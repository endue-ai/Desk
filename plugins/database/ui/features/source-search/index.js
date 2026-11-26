// The source of routines, views and table parts searched (PG-82): a panel per connection with what to
// find (a text or a regular expression, ignoring case, comments too), the scope (one schema, this
// database, every connection) and the kinds of object; the definitions the schema cache holds and the
// bodies it does not, read once per read of a schema, matched line by line (in a worker for big
// texts) with progress and Cancel; each object with its matching lines, a line opening the source
// there. Commands: Database: search the source (agents get it read-only) and Database: cancel the
// source search. Nothing is replaced here: a rename goes through its own command. The panel keeps
// its options across a restart, never its results. controller.js runs it, panel.js draws.

import { t } from "../../strings/index.js";
import { createSourcePanels, TYPE } from "./controller.js";
import { sourcePanel } from "./panel.js";

/** One controller per plugin, shared by the feature's commands and actions. */
const controllers = new WeakMap();
const of = (/** @type {import("../../feature-host.js").Deps} */ deps) => {
  let controller = controllers.get(deps);
  if (!controller) {
    controller = createSourcePanels(deps);
    controllers.set(deps, controller);
  }
  return /** @type {ReturnType<typeof createSourcePanels>} */ (controller);
};

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "source-search",
  commands: (deps) => {
    const search = of(deps);
    return {
      "endue.database.search-source": (args) => search.open(args),
      "endue.database.search-source-cancel": () => search.cancel(undefined),
    };
  },
  actions: (deps) => {
    const search = of(deps);
    return {
      sourceChange: (/** @type {string} */ id, /** @type {Record<string, unknown>} */ fields) =>
        search.change(id, fields),
      sourceStart: async (
        /** @type {string} */ id,
        /** @type {Record<string, unknown>} */ fields,
      ) => {
        await search.start(id, fields);
      },
      sourceCancel: (/** @type {string} */ id) => search.cancel(id),
      sourceOpen: (
        /** @type {string} */ id,
        /** @type {number} */ object,
        /** @type {number} */ line,
      ) => search.openHit(id, object, line),
    };
  },
  panels: {
    [TYPE]: {
      label: t("features.sourceSearch.index.searchTheSource"),
      render: sourcePanel,
      keep: (/** @type {import("./controller.js").SourceState} */ state) => ({
        ...state,
        run: null,
        error: "",
      }),
    },
  },
  styles: [new URL("./source-search.css", import.meta.url).href],
};
