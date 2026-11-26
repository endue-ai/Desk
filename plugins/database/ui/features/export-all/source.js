// What a whole export reads (PG-64): the statement of the result on screen (or `sql` given), the
// table a table view shows (or `table` given), or the tables of a schema for a folder. PostgreSQL
// only: COPY through the session is the stream. The statement is one read, without bound values
// (COPY takes none). No DOM.

import { engineOf } from "../../engines/index.js";
import { classify, readsOnly } from "../../sql/classify.js";
import { qualified } from "../../sql/quote.js";
import { split } from "../../sql/split.js";
import { t } from "../../strings/index.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {{ name: string, query: string, table?: string }} Item
 *   `name` the file's (a table's or `result`), `table` the one SQL INSERT and UPDATE name.
 */

/** Refuses another engine. */
export function postgresOnly(/** @type {Connection} */ conn) {
  if (engineOf(conn.engine).dialect !== "postgresql")
    throw new Error(
      t("features.exportAll.source.exportingEveryRowStreamsThroughPostgresql", {
        name: String(conn.name),
        title: String(engineOf(conn.engine).title),
      }),
    );
}

/** Refuses a statement with bound values (PG-21), which COPY does not take. */
function unbound(/** @type {unknown} */ statement) {
  if (/** @type {{ params?: unknown[] }} */ (statement).params?.length)
    throw new Error(t("features.exportAll.source.copyTakesNoBoundValuesWrite"));
}

/** One read the COPY can wrap, or the sentence that refuses it. */
export function readOf(/** @type {string} */ sql) {
  const statements = split(sql, "postgresql");
  if (statements.length !== 1)
    throw new Error(t("features.exportAll.source.exportEveryRowTakesOneStatement"));
  const statement = /** @type {import("../../sql/split.js").Statement} */ (statements[0]);
  unbound(statement);
  const cls = classify(statement, "postgresql");
  if (!cls.rows || !readsOnly([cls]))
    throw new Error(t("features.exportAll.source.onlyAReadExportsEveryRow"));
  return statement.text;
}

/** A table as an item: its query and the name its SQL formats write. */
export const tableItem = (/** @type {string} */ schema, /** @type {string} */ name) => ({
  name: schema && schema !== "public" ? `${schema}.${name}` : name,
  query: `SELECT * FROM ${qualified("postgresql", schema, name)}`,
  table: qualified("postgresql", schema, name),
});

/** "schema.table" or "table" (public). */
export function tableRef(/** @type {string} */ ref) {
  const cut = ref.indexOf(".");
  return cut > 0 ? tableItem(ref.slice(0, cut), ref.slice(cut + 1)) : tableItem("public", ref);
}

/**
 * The connection and the item of the command's arguments or the buffer on screen.
 * @param {Deps} deps
 * @param {{ connection?: string, sql?: string, table?: string }} args
 * @returns {Promise<{ conn: Connection, item: Item }>}
 */
export async function sourceOf(deps, args) {
  const shown = deps.consoles.current();
  if (args.sql !== undefined || args.table !== undefined) {
    const conn = await deps.manager.choose(
      args.connection ?? shown?.connection,
      t("features.exportAll.source.databaseExportEveryRowFromWhich"),
    );
    if (!conn) throw deps.cancelled(t("features.exportAll.source.notExported"));
    postgresOnly(conn);
    if (typeof args.table === "string") return { conn, item: tableRef(args.table) };
    return { conn, item: { name: "result", query: readOf(String(args.sql)) } };
  }
  const conn = shown ? deps.manager.get(shown.connection) : undefined;
  if (!shown || !conn) throw new Error(t("features.exportAll.source.nothingToExportOpenATable"));
  postgresOnly(conn);
  if (shown.kind === "table" && shown.table)
    return { conn, item: tableItem(shown.table.schema, shown.table.name) };
  const tab = shown.shown?.tabs[shown.tab];
  const statement = tab ? shown.execution?.statements[tab.statement] : undefined;
  if (!statement || !tab?.set)
    throw new Error(t("features.exportAll.source.noResultHereRunAQuery"));
  unbound(statement);
  const target = shown.edit?.target;
  const table = target ? qualified("postgresql", target.schema, target.name) : undefined;
  return {
    conn,
    item: {
      name: target?.name ?? "result",
      query: readOf(statement.text),
      ...(table ? { table } : {}),
    },
  };
}
