// What following a key starts from (PG-41, ADR 0322): the result on screen on a PostgreSQL
// connection, the one table its rows come from (a table's view, or a console's plain SELECT of one
// table), a row's values with their pending changes, the grid's cursor, and the table's keys both
// ways: from the schema cache when it holds the table (ADR 0285), else from pg_constraint. No DOM.

import { defaultSchema } from "../../catalog.js";
import { sourceOf } from "../../edit/source.js";
import { shownSet } from "../../edits.js";
import { engineOf } from "../../engines/index.js";
import { valueAt } from "../../grid-model.js";
import { keysOfCache, keysOfRows, keysSql } from "../../links/model.js";
import { numericColumns } from "../../results.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../consoles.js").Console} Console
 * @typedef {import("../../links/model.js").Keys} Keys
 */

const PG_ONLY = "Following foreign keys is for PostgreSQL connections.";

/** The one table a console's or a table view's rows come from, or undefined. */
function sourceTable(/** @type {Console} */ target, /** @type {Connection} */ conn) {
  if (target.kind === "table" && target.table)
    return { schema: target.table.schema, name: target.table.name };
  const tab = target.shown?.tabs[target.tab];
  const statement = target.execution?.statements[tab?.statement ?? 0];
  if (!statement || target.execution?.statements.length !== 1) return undefined;
  const found = sourceOf(statement, engineOf(conn.engine).dialect);
  return found ? { schema: found.schema ?? defaultSchema(conn), name: found.name } : undefined;
}

/** The result on screen and where its rows come from, or an Error that says why not. */
export function onScreen(/** @type {Deps} */ deps) {
  const target = deps.consoles.current();
  const set = target ? shownSet(target) : undefined;
  if (!target || !set) throw new Error("No result is on screen: run a query or open a table.");
  const conn = deps.manager.get(target.connection);
  if (!conn) throw new Error("This result's connection was removed.");
  if (conn.engine !== "postgresql") throw new Error(PG_ONLY);
  const source = sourceTable(target, conn);
  if (!source)
    throw new Error("This result does not come from one table: its keys cannot be followed.");
  const changes = target.edit?.status === "ready" ? target.edit.changes : null;
  return {
    target,
    conn,
    set,
    source,
    numeric: numericColumns(set),
    /** A result row's values as the grid shows them, pending changes in. */
    row: (/** @type {number} */ row) =>
      set.columns.map((_, c) => valueAt(set, changes, row, c).value),
  };
}

/** The grid's cursor: its result row and column. */
export function cursorOf(/** @type {Deps} */ deps) {
  const cell = deps.view.cell();
  if (!cell) throw new Error("Put the grid's cursor on a cell first.");
  return { row: cell.row, col: cell.col };
}

/**
 * A table's keys both ways: the cache's when it holds the table, else one read of pg_constraint.
 * `quiet` never asks for a password (the grid reading its links).
 * @param {Deps} deps
 * @param {Connection} conn
 * @param {{ schema: string, name: string }} table
 * @returns {Promise<Keys>}
 */
export async function readKeys(deps, conn, table, quiet = false) {
  const { cache } = deps.catalog;
  if (cache.cached(conn)) {
    await cache.open(conn, quiet).catch(() => {});
    const held = keysOfCache(cache.view(conn), table.schema, table.name);
    if (held) return held;
  }
  const run = await deps.execute(conn, keysSql(table.schema, table.name), {
    catalog: true,
    ...(quiet ? { interactive: false } : {}),
  });
  const error = run.result.error ?? run.result.statements[0]?.error;
  if (error) throw new Error(error.message);
  return keysOfRows(run.result.statements[0]?.sets[0]?.rows ?? [], table.schema, table.name);
}
