// The result grid's columns, quick filters, sort keys and find as commands (#469): each acts on the
// grid on screen at its cursor, through the view (`view.grid`, ui/view-grid.js), as its keys do. The
// actions the grid calls itself: a table view's columns kept in the plugin's store and read back
// (ADR 0288), a hidden column picked to show again, and the text of a "contains" filter asked for.
// No DOM.

import { keepColumns, readColumns } from "../../grid/columns.js";
import { menuLabel, OPS } from "../../grid/filters.js";
import { t } from "../../strings/index.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../grid/rows.js").FilterOp} FilterOp
 */

/** A table view's grid key (`table:<connection>:<schema>.<name>`) as its key in the store. */
const storeKey = (/** @type {unknown} */ key) =>
  typeof key === "string" && key.startsWith("table:") ? `grid:${key.slice(6)}` : undefined;

/** The grid on screen, or an Error that says what to do. */
function gridOf(/** @type {Deps} */ deps) {
  const grid = deps.view.grid;
  return (/** @type {string} */ op, /** @type {Record<string, unknown>} */ args = {}) => {
    const done = grid?.(op, args);
    if (done === undefined) throw new Error(t("features.grid.index.noResultIsOnScreenRun"));
    if (typeof done === "string" && done) deps.say(done);
    return done;
  };
}

/** Pick a hidden column of the grid on screen and show it again. */
async function showColumn(/** @type {Deps} */ deps, /** @type {unknown} */ column) {
  const grid = gridOf(deps);
  const shape = /** @type {{ hidden: string[] }} */ (grid("columns"));
  if (shape.hidden.length === 0) throw new Error(t("features.grid.index.noColumnOfThisResultIs"));
  const chosen =
    typeof column === "string"
      ? column
      : await deps.pick(
          t("features.grid.index.databaseShowWhichColumn"),
          shape.hidden.map((key) => ({ id: key, label: key })),
        );
  if (!chosen) return undefined;
  return grid("show", { column: chosen });
}

/** Ask for a "contains" filter's text when none is given, then filter by it. */
async function contains(/** @type {Deps} */ deps, /** @type {unknown} */ value) {
  const text =
    typeof value === "string"
      ? value
      : await deps.pick(t("features.grid.index.databaseKeepTheRowsWhoseCell"), [], true, "text");
  if (text === undefined || text === "") return undefined;
  return gridOf(deps)("filter", { op: "contains", value: text });
}

/** Filter by the cursor's cell: the operation given, or one picked. */
async function filterByCell(/** @type {Deps} */ deps, /** @type {Record<string, unknown>} */ args) {
  const op =
    typeof args.op === "string"
      ? args.op
      : await deps.pick(
          t("features.grid.index.databaseKeepTheRowsWhoseCell2"),
          OPS.map((id) => ({ id, label: menuLabel(id, "the cell's value", false) })),
        );
  if (!op) return undefined;
  if (!OPS.includes(/** @type {FilterOp} */ (op)))
    throw new Error(
      t("features.grid.index.databaseAFilterIsOneOf", { value: String(OPS.join(", ")) }),
    );
  if (op === "contains") return contains(deps, args.value);
  return gridOf(deps)("filter", { op });
}

/** Commands that run one operation of the grid by name. */
const SIMPLE = {
  "endue.database.hide-column": "hide",
  "endue.database.move-column-left": "moveLeft",
  "endue.database.move-column-right": "moveRight",
  "endue.database.pin-column": "pin",
  "endue.database.fit-column": "fit",
  "endue.database.narrow-column": "narrower",
  "endue.database.widen-column": "wider",
  "endue.database.reset-columns": "reset",
  "endue.database.add-sort": "addSort",
  "endue.database.clear-filters": "clearFilters",
  "endue.database.find-next": "findNext",
  "endue.database.find-previous": "findPrevious",
};

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "grid",
  commands: (deps) => ({
    ...Object.fromEntries(Object.entries(SIMPLE).map(([id, op]) => [id, () => gridOf(deps)(op)])),
    "endue.database.show-column": ({ column }) => showColumn(deps, column),
    "endue.database.filter-by-cell": (args) => filterByCell(deps, args),
    "endue.database.find-in-result": ({ text }) =>
      gridOf(deps)("find", typeof text === "string" ? { text } : {}),
  }),
  actions: (deps) => ({
    columnsLoad: async (/** @type {unknown} */ key) => {
      const at = storeKey(key);
      if (!at) return undefined;
      const kept = await deps.bridge.call("store.get", { key: at }).catch(() => ({}));
      return kept.value === undefined ? undefined : readColumns(kept.value);
    },
    columnsKeep: async (/** @type {unknown} */ key, /** @type {unknown} */ state) => {
      const at = storeKey(key);
      if (!at) return;
      const value = keepColumns(readColumns({ v: 1, .../** @type {object} */ (state) }));
      await deps.bridge.call("store.set", { key: at, value });
    },
    showColumns: () => showColumn(deps, undefined),
    askContains: () => contains(deps, undefined),
  }),
  styles: [new URL("../../grid/grid.css", import.meta.url).href],
};
