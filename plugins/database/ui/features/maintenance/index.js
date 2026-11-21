// Maintenance (PG-73): a form per PostgreSQL connection and target (a table, an index, a schema,
// the database) that runs VACUUM, ANALYZE, REINDEX or CLUSTER with the options of the server's
// version, shows the statement and says in words what it locks and for how long, runs it alone
// outside a transaction block under the plugin's write guards, follows it in the server's progress
// views with Cancel, and shows the statistics before and after. Commands: Database: maintenance
// (also an agent's tool, which asks the person before it runs; the server overview can open a
// table's form with it), run, cancel and read the form again. The explorer's m opens it. The form
// keeps nothing across a restart. controller.js reads and runs, panel.js and result.js draw.

import { createMaintenance, TYPE } from "./controller.js";
import { maintenancePanel } from "./panel.js";

/** One controller per plugin, shared by the feature's commands and actions. */
const controllers = new WeakMap();
const of = (/** @type {import("../../feature-host.js").Deps} */ deps) => {
  let controller = controllers.get(deps);
  if (!controller) {
    controller = createMaintenance(deps);
    controllers.set(deps, controller);
  }
  return /** @type {ReturnType<typeof createMaintenance>} */ (controller);
};

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "maintenance",
  commands: (deps) => {
    const m = of(deps);
    return {
      "endue.database.maintenance": (args) => m.open(args),
      "endue.database.maintenance-run": () => m.runShown(),
      "endue.database.maintenance-cancel": () => m.cancelShown(),
      "endue.database.maintenance-refresh": () => m.refreshShown(),
    };
  },
  actions: (deps) => {
    const m = of(deps);
    return {
      maintain: (/** @type {import("../../explorer.js").Node} */ node) => m.fromNode(node),
      maintenanceView: (/** @type {string} */ id, /** @type {Record<string, unknown>} */ patch) =>
        m.view(id, patch),
      maintenanceRun: (/** @type {string} */ id) => m.run(id),
      maintenanceCancel: (/** @type {string} */ id) => m.cancel(id),
      maintenanceRefresh: (/** @type {string} */ id) => m.refresh(id),
      maintenanceProgress: (/** @type {string} */ id) => m.progress(id),
    };
  },
  panels: { [TYPE]: { label: "Maintenance", render: maintenancePanel } },
  styles: [new URL("./maintenance.css", import.meta.url).href],
};
