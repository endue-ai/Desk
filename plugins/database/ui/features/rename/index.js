// Rename and the other refactorings of a statement (PG-33): Database: rename the name at the caret
// (F2 in the console), rename an object with the script that keeps its dependents working, extract
// a subquery into a CTE, inline a CTE, and qualify every name. A statement's change is one edit in
// the console; an object's rename opens its script in a console of its own and runs nothing. The
// work is refactor/controller.js's.
import { createRefactor } from "../../refactor/controller.js";

/** @typedef {import("../../feature-host.js").Deps} Deps */

/** One controller per plugin, shared by the feature's commands and its key. */
const controllers = new WeakMap();
const of = (/** @type {Deps} */ deps) => {
  let made = controllers.get(deps);
  if (!made) {
    made = createRefactor(deps);
    controllers.set(deps, made);
  }
  return /** @type {ReturnType<typeof createRefactor>} */ (made);
};

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "rename",
  commands: (deps) => ({
    "endue.database.rename-at-caret": (args) => of(deps).rename(args),
    "endue.database.rename-with-dependents": (args) =>
      typeof args?.name === "string" ? of(deps).renameNamed(args) : of(deps).rename(args),
    "endue.database.extract-cte": (args) => of(deps).extract(args),
    "endue.database.inline-cte": () => of(deps).inline(),
    "endue.database.qualify-names": () => of(deps).qualify(),
  }),
  actions: (deps) => ({ renameAtCaret: () => of(deps).rename({}) }),
};
