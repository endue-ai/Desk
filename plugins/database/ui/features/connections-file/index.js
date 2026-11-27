// Connections moved with one file (PG-15, ADR 0332): Database: export connections to a file and
// Database: import connections from a file (a connections file, or a pg_service.conf). The format
// is file.js's; the flows transfer.js's; the dialogs export-form.js's and import-form.js's.

import { t } from "../../strings/index.js";
import { exportDialog } from "./export-form.js";
import { importDialog } from "./import-form.js";
import { exportConnections, importConnections } from "./transfer.js";

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "connectionsFile",
  commands: (deps) => ({
    "endue.database.export-connections": (args) => exportConnections(deps, args),
    "endue.database.import-connections": () => importConnections(deps),
  }),
  dialogs: {
    connectionsExport: {
      label: t("features.connectionsFile.index.exportConnections"),
      render: exportDialog,
    },
    connectionsImport: {
      label: t("features.connectionsFile.index.importConnections"),
      render: importDialog,
    },
  },
  styles: [new URL("./connections-file.css", import.meta.url).href],
};
