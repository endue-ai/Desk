// A whole table or query exported straight to a file, however large (PG-64, ADR 0365): every row
// streamed from PostgreSQL's COPY in one read-only snapshot, never through the grid, written under a
// temporary name and renamed at the end, in a panel with its rows, bytes and Cancel. Commands:
// Database: export every row to a file, export tables to a folder, cancel the export.

import { t } from "../../strings/index.js";
import { exportAllDialog } from "./dialog.js";
import { createJobs, TYPE } from "./jobs.js";
import { exportAllPanel } from "./panel.js";
import { exportAll, exportTables } from "./run.js";

/** One set of jobs per plugin, shared by the feature's commands and actions. */
const all = new WeakMap();
const jobsOf = (/** @type {import("../../feature-host.js").Deps} */ deps) => {
  let jobs = all.get(deps);
  if (!jobs) {
    jobs = createJobs(deps);
    all.set(deps, jobs);
  }
  return /** @type {ReturnType<typeof createJobs>} */ (jobs);
};

/** Cancel the export on screen, else the only one running. */
function cancel(
  /** @type {import("../../feature-host.js").Deps} */ deps,
  /** @type {unknown} */ id,
) {
  const jobs = jobsOf(deps);
  const shown = deps.consoles.current();
  const running = jobs.running();
  const target =
    typeof id === "string"
      ? id
      : shown?.kind === TYPE && running.includes(shown.id)
        ? shown.id
        : running.length === 1
          ? running[0]
          : undefined;
  if (target === undefined)
    throw new Error(
      running.length
        ? t("features.exportAll.index.showTheExportToCancelFirst")
        : t("features.exportAll.index.noExportIsRunning"),
    );
  if (!jobs.cancel(target)) throw new Error(t("features.exportAll.index.thatExportHasEnded"));
  deps.say(t("features.exportAll.index.cancelling"));
  return { cancelled: target };
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "export-all",
  commands: (deps) => ({
    "endue.database.export-all": (args) => exportAll(deps, jobsOf(deps), args ?? {}),
    "endue.database.export-tables": (args) => exportTables(deps, jobsOf(deps), args ?? {}),
    "endue.database.export-cancel": ({ id } = {}) => cancel(deps, id),
  }),
  actions: (deps) => ({
    exportAllCancel: (/** @type {string} */ id) => cancel(deps, id),
  }),
  panels: {
    [TYPE]: { label: t("features.exportAll.index.exportEveryRow"), render: exportAllPanel },
  },
  dialogs: {
    "export-all-options": {
      label: t("features.exportAll.index.exportEveryRow"),
      render: exportAllDialog,
    },
  },
  styles: [new URL("./export-all.css", import.meta.url).href],
};
