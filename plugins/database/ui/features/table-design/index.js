// The table form (PG-51, ADR 0324): a PostgreSQL table created, or an existing one changed, by
// editing its design (columns, keys, checks, foreign keys, indexes, partitioning, comment and owner)
// while the exact script grows below it, dangerous steps marked; Run applies it in one transaction
// (CONCURRENTLY indexes after it), Dry run rolls it back, Open in console hands it over. A rename is
// a rename. Commands: Database: create a table, change a table (both agents' tools that fill the
// form for the person to run), and run, dry-run, open in a console or read again the form on screen.
// The explorer's row menu (features/objects/, tableEntries) opens it on a schema or a table.
// controller.js reads and keeps the form, runs.js runs, script.js writes; panel.js draws.

import { t as messageText } from "../../strings/index.js";
import { createTableDesign, TYPE } from "./controller.js";
import { tableDesignPanel } from "./panel.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {{ kind: string, schema: string, name: string }} Target
 */

/** One controller per plugin, shared by the feature's commands and actions. */
const controllers = new WeakMap();
const of = (/** @type {Deps} */ deps) => {
  let made = controllers.get(deps);
  if (!made) {
    made = createTableDesign(deps);
    controllers.set(deps, made);
  }
  return /** @type {ReturnType<typeof createTableDesign>} */ (made);
};

/** What the explorer's row menu offers first for a PostgreSQL schema or table. */
export function tableEntries(/** @type {Connection} */ conn, /** @type {Target} */ target) {
  if (conn.engine !== "postgresql") return [];
  if (target.kind === "schema")
    return [{ id: "create-table", label: messageText("features.tableDesign.index.newTable") }];
  if (target.kind === "table")
    return [
      {
        id: "change-table",
        label: messageText("features.tableDesign.index.changeTheTableSDesign"),
      },
    ];
  return [];
}

/** Open the form a row menu's entry names. */
export function openTableEntry(
  /** @type {Deps} */ deps,
  /** @type {Connection} */ conn,
  /** @type {Target} */ target,
  /** @type {string} */ entry,
) {
  const forms = of(deps);
  if (entry === "create-table")
    return forms.openFor(conn, "create", { schema: target.schema, name: "" });
  return forms.openFor(conn, "change", { schema: target.schema, name: target.name });
}

/** The connection, the schema and (to change one) the table a command names; the palette asks. */
async function chosen(
  /** @type {Deps} */ deps,
  /** @type {Record<string, any>} */ args,
  /** @type {boolean} */ table,
) {
  const conn = await deps.manager.choose(
    typeof args.connection === "string" ? args.connection : undefined,
    messageText("features.tableDesign.index.databaseWhichConnection"),
  );
  if (!conn) throw deps.cancelled(messageText("features.tableDesign.index.nothingPicked"));
  if (conn.engine !== "postgresql")
    throw new Error(messageText("features.tableDesign.index.theTableFormIsPostgresqlS"));
  const schema =
    typeof args.schema === "string"
      ? args.schema
      : await deps.pick(
          messageText("features.tableDesign.index.databaseInWhichSchema"),
          (await deps.catalog.schemas(conn)).map((s) => ({ id: s, label: s })),
        );
  if (!schema) throw deps.cancelled(messageText("features.tableDesign.index.nothingPicked"));
  if (!table) return { conn, schema, name: "" };
  const tables = (await deps.catalog.objects(conn, schema)).filter((o) => o.kind === "table");
  const name =
    typeof args.name === "string"
      ? args.name
      : await deps.pick(
          messageText("features.tableDesign.index.databaseWhichTableOf", {
            schema: String(schema),
          }),
          tables.map((t) => ({ id: t.name, label: t.name })),
        );
  if (!name) throw deps.cancelled(messageText("features.tableDesign.index.nothingPicked"));
  return { conn, schema, name };
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "tableDesign",
  commands: (deps) => {
    const forms = of(deps);
    return {
      "endue.database.create-table": async (args) => {
        const { conn, schema } = await chosen(deps, args, false);
        return forms.openFor(conn, "create", { schema, name: "" }, args);
      },
      "endue.database.change-table": async (args) => {
        const { conn, schema, name } = await chosen(deps, args, true);
        return forms.openFor(conn, "change", { schema, name });
      },
      "endue.database.table-design-run": () => forms.run(forms.shown()),
      "endue.database.table-design-dry-run": () => forms.run(forms.shown(), true),
      "endue.database.table-design-console": () => forms.toConsole(forms.shown()),
      "endue.database.table-design-refresh": async () => {
        const read = await forms.refresh(forms.shown());
        if (!read)
          throw new Error(
            forms.stateOf(forms.shown())?.error ||
              messageText("features.tableDesign.index.notRead"),
          );
        return { read: true };
      },
    };
  },
  actions: (deps) => {
    const forms = of(deps);
    return {
      tableDesignEdit: (/** @type {string} */ id, /** @type {Record<string, any>} */ patch) =>
        forms.edit(id, patch),
      tableDesignRun: (/** @type {string} */ id) => forms.run(id),
      tableDesignDryRun: (/** @type {string} */ id) => forms.run(id, true),
      tableDesignConsole: (/** @type {string} */ id) => forms.toConsole(id),
      tableDesignRefresh: (/** @type {string} */ id) => forms.refresh(id),
      tableDesignRefs: (/** @type {string} */ id, /** @type {string} */ schema, table = "") =>
        forms.refs(id, schema, table),
    };
  },
  panels: {
    [TYPE]: {
      label: messageText("features.tableDesign.index.tableDesign"),
      render: tableDesignPanel,
    },
  },
  styles: [new URL("./table-design.css", import.meta.url).href],
};
