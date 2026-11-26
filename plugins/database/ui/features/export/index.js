// Export a result to a file (PG-61): the command (run.js) and its options dialog (dialog.js). The
// place is always the one the person chooses in the desk's save dialog (../../export.js).

import { t } from "../../strings/index.js";
import { optionsDialog } from "./dialog.js";
import { exportShown } from "./run.js";

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "export",
  commands: (deps) => ({
    "endue.database.export": (args) => exportShown(deps, args ?? {}),
  }),
  dialogs: {
    "export-options": { label: t("features.export.index.exportOptions"), render: optionsDialog },
  },
};
