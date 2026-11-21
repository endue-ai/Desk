// Routines (PG-56): a PostgreSQL function or procedure run from a form of its arguments. Each
// argument is edited by its type with the typed cell editors (ADR 0287), NULL and DEFAULT are
// choices of their own, VARIADIC is a list, and the exact call (SELECT, SELECT * FROM or CALL, by
// name where the arguments have names, every literal quoted and cast) shows before it runs in the
// connection's console, whose result tabs and Messages show what came back and the notices.
// Volatility decides the guard: VOLATILE functions and procedures run as writes (guard.js), with
// an offer to run in a transaction rolled back at the end. Commands: Database: run a function or
// procedure (also an agent's tool, asked before a write runs), run the form on screen, read it
// again. The explorer's x opens a routine's form; the arguments typed are kept for the session.
// controller.js reads and runs, panel.js and fields.js draw, call.js writes the call.

import { createRoutines, TYPE } from "./controller.js";
import { routinePanel } from "./panel.js";

/** One controller per plugin, shared by the feature's commands and actions. */
const controllers = new WeakMap();
const of = (/** @type {import("../../feature-host.js").Deps} */ deps) => {
  let controller = controllers.get(deps);
  if (!controller) {
    controller = createRoutines(deps);
    controllers.set(deps, controller);
  }
  return /** @type {ReturnType<typeof createRoutines>} */ (controller);
};

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "routines",
  commands: (deps) => {
    const r = of(deps);
    return {
      "endue.database.routine": (args) => r.open(args),
      "endue.database.routine-run": () => r.runShown(),
      "endue.database.routine-refresh": () => r.refreshShown(),
    };
  },
  actions: (deps) => {
    const r = of(deps);
    return {
      routine: (/** @type {import("../../explorer.js").Node} */ node) => r.fromNode(node),
      routineView: (/** @type {string} */ id, /** @type {Record<string, unknown>} */ patch) =>
        r.view(id, patch),
      routineRun: (/** @type {string} */ id, /** @type {unknown[] | undefined} */ entries) =>
        r.run(id, entries ? { entries: /** @type {any} */ (entries) } : {}),
      routineRefresh: (/** @type {string} */ id) => r.refresh(id),
    };
  },
  panels: { [TYPE]: { label: "Routine", render: routinePanel } },
  styles: [new URL("./routines.css", import.meta.url).href],
};
