// The server's activity (PG-71): a panel per PostgreSQL connection with its sessions, who waits for
// whom on which lock, and its locks, read again by hand and every few seconds; a session's
// statement cancelled or the session ended, always asked first and never on a read-only connection.
// Commands: Database: server activity (agents get it read-only: it answers the sessions and the
// waits), refresh it, cancel a session's statement and end a session (agents get both as
// irreversible). The panel keeps nothing across a restart. controller.js reads and signals,
// panel.js and tables.js draw.

import { createActivity, TYPE } from "./controller.js";
import { activityPanel } from "./panel.js";

/** One controller per plugin, shared by the feature's commands and actions. */
const controllers = new WeakMap();
const of = (/** @type {import("../../feature-host.js").Deps} */ deps) => {
  let controller = controllers.get(deps);
  if (!controller) {
    controller = createActivity(deps);
    controllers.set(deps, controller);
  }
  return /** @type {ReturnType<typeof createActivity>} */ (controller);
};

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "activity",
  commands: (deps) => {
    const activity = of(deps);
    return {
      "endue.database.activity": (args) => activity.open(args),
      "endue.database.activity-refresh": (args) => activity.refreshCommand(args),
      "endue.database.cancel-session": (args) => activity.stopSession("cancel", args),
      "endue.database.end-session": (args) => activity.stopSession("end", args),
    };
  },
  actions: (deps) => {
    const activity = of(deps);
    return {
      // The panel's period says "timer": a read of its own, which Disconnect stops (ADR 0339).
      activityRefresh: (/** @type {string} */ id, /** @type {unknown} */ by) =>
        activity.refresh(id, false, by === "timer"),
      activityView: (/** @type {string} */ id, /** @type {Record<string, unknown>} */ patch) =>
        activity.view(id, patch),
      activityStop: (/** @type {string} */ id, /** @type {"cancel" | "end"} */ how, pid) =>
        activity.stopFrom(id, how, pid),
    };
  },
  panels: { [TYPE]: { label: "Server activity", render: activityPanel } },
  styles: [new URL("./activity.css", import.meta.url).href],
};
