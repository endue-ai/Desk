// Backup and restore (PG-62, ADR 0313): a database, or chosen schemas or tables, backed up with
// pg_dump in any of its four formats, and a dump restored with pg_restore (or, a plain SQL file, run
// as a script), each from a form whose exact command line it shows, in a log panel of its own with
// Cancel. The programs are found and checked as the clients are (clients.js). Commands: Database:
// back up a database, restore a database, cancel the backup or restore. Agents get the first two:
// the form opens for the person, who submits it (restore is irreversible).

import { t } from "../../strings/index.js";
import { backup } from "./backup.js";
import { backupDialog } from "./backup-form.js";
import { createJobs, TYPE } from "./job.js";
import { logPanel } from "./log-panel.js";
import { restore } from "./restore.js";
import { restoreDialog } from "./restore-form.js";

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

/** Cancel the run on screen, else the only one running. */
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
      : shown?.kind === TYPE && running.some((b) => b.id === shown.id)
        ? shown.id
        : running.length === 1
          ? running[0]?.id
          : undefined;
  if (target === undefined)
    throw new Error(
      running.length
        ? t("features.backup.index.showTheOneToCancelFirst")
        : t("features.backup.index.noBackupOrRestoreIsRunning"),
    );
  if (!jobs.cancel(target)) throw new Error(t("features.backup.index.thatBackupOrRestoreHasEnded"));
  deps.say(t("features.backup.index.cancelling"));
  return { cancelled: target };
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "backup",
  commands: (deps) => ({
    "endue.database.backup": (args) => backup(deps, jobsOf(deps), args),
    "endue.database.restore": (args) => restore(deps, jobsOf(deps), args),
    "endue.database.backup-cancel": ({ id }) => cancel(deps, id),
  }),
  actions: (deps) => ({
    backupCancel: (/** @type {string} */ id) => cancel(deps, id),
  }),
  panels: { [TYPE]: { label: t("features.backup.index.backupOrRestore"), render: logPanel } },
  dialogs: {
    backup: { label: t("features.backup.index.backUpADatabase"), render: backupDialog },
    restore: { label: t("features.backup.index.restoreADatabase"), render: restoreDialog },
  },
  styles: [new URL("./backup.css", import.meta.url).href],
};
