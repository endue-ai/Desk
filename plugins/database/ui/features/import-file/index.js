// Database: import a file into a table (PG-60, ADR 0363): the import wizard on a file the command
// names or one the person picks, as a drop of it opens it (import-copy/open.js).

import { importFile } from "../../import-copy/open.js";

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "importFile",
  commands: (deps) => ({
    "endue.database.import-file": (args) => importFile(deps, args),
  }),
};
