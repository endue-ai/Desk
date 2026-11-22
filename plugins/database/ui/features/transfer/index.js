// A table or a query's result copied to another database or into a new table (PG-63): the feature's
// commands, actions, panel and form; the work is in ../../transfer/ (controller.js). Commands:
// Database: copy tables to another database, copy the query's result into a table, start the copy,
// cancel the copy. Nothing runs before the person starts it in the panel.

import { createTransfers, TYPE } from "../../transfer/controller.js";
import { transferDialog } from "../../transfer/form.js";
import { transferPanel } from "../../transfer/panel.js";

/** One set of copies per plugin, shared by the feature's commands and actions. */
const all = new WeakMap();
const transfersOf = (/** @type {import("../../feature-host.js").Deps} */ deps) => {
  let made = all.get(deps);
  if (!made) {
    made = createTransfers(deps);
    all.set(deps, made);
  }
  return /** @type {ReturnType<typeof createTransfers>} */ (made);
};

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "transfer",
  commands: (deps) => ({
    "endue.database.transfer": (args) => transfersOf(deps).tables(args),
    "endue.database.transfer-query": (args) => transfersOf(deps).query(args),
    "endue.database.transfer-start": ({ id }) => transfersOf(deps).start(id),
    "endue.database.transfer-cancel": ({ id }) => transfersOf(deps).cancel(id),
  }),
  actions: (deps) => ({
    transferStart: (/** @type {string} */ id) => transfersOf(deps).start(id),
    transferCancel: (/** @type {string} */ id) => transfersOf(deps).cancel(id),
    transferMap: (
      /** @type {string} */ id,
      /** @type {string} */ column,
      /** @type {string} */ into,
    ) => transfersOf(deps).map(id, column, into),
  }),
  panels: { [TYPE]: { label: "Copy between databases", render: transferPanel } },
  dialogs: { [TYPE]: { label: "Copy to another database", render: transferDialog } },
  styles: [new URL("../../transfer/transfer.css", import.meta.url).href],
};
