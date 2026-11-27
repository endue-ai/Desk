// Agents' access and audit (PG-91, ADR 0346). Commands: the agents' read tools (tools.js: explain a
// statement, an object's DDL, a table's sample rows, its statistics, the sessions list, a check of a
// statement without running it), every one read-only, limited and masked; and the person's own:
// Database: agent audit (the panel), what agents may reach of a connection, export and clear the
// list. What watches every call (gate.js) is made in database.js and found here by the bridge.
// controller.js answers the person, panel.js draws.

import { t } from "../../strings/index.js";
import { agentsOf } from "./agents.js";
import { createAudit, TYPE } from "./controller.js";
import { auditPanel } from "./panel.js";
import { agentTools } from "./tools.js";

/** The plugin's agents, which database.js makes before any feature. */
const need = (/** @type {object} */ bridge) => {
  const agents = agentsOf(bridge);
  if (!agents) throw new Error(t("features.audit.index.thePluginSAgentsAreNot"));
  return agents;
};

/** One controller per plugin, shared by the feature's commands and actions. */
const controllers = new WeakMap();
const of = (/** @type {import("../../feature-host.js").Deps} */ deps) => {
  let controller = controllers.get(deps);
  if (!controller) {
    controller = createAudit(deps, need(deps.bridge));
    controllers.set(deps, controller);
  }
  return /** @type {ReturnType<typeof createAudit>} */ (controller);
};

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "audit",
  commands: (deps) => ({ ...agentTools(deps, need(deps.bridge)), ...of(deps).commands }),
  actions: (deps) => of(deps).actions,
  panels: { [TYPE]: { label: t("features.audit.index.agentAudit"), render: auditPanel } },
  styles: [new URL("./audit.css", import.meta.url).href],
};
