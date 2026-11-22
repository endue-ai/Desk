// Results a page at a time. A table's view pages through its rows under the filter and order the
// person typed (WHERE, ORDER BY, LIMIT, OFFSET), counts them on request, and asks the server for the
// grid's sort keys (its ORDER BY) and quick filters (after the typed WHERE, grid/filters.js). A
// console's single SELECT pages the same way when it has no LIMIT, OFFSET, FETCH, FOR or INTO of its
// own: the next page runs it again with LIMIT and OFFSET.

import { tableSql } from "./catalog.js";
import { engineOf } from "./engines/index.js";
import { formatCount } from "./format.js";
import { orderSql, whereWith } from "./grid/filters.js";
import { createRowsControl, windowed } from "./rows/control.js";
import { split } from "./sql/split.js";
import { createNaturalOrder } from "./table-order.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./consoles.js").Console} Console
 * @typedef {import("./sql/split.js").Statement} Statement
 * @typedef {{
 *   settings(): import("./settings.js").Settings,
 *   run(target: Console, conn: Connection, sql: string, options: { maxRows?: number, history?: boolean, statements?: Statement[] }): Promise<string>,
 *   execute: import("./catalog.js").Execute,
 *   render(): void,
 *   sessions?: import("./rows/control.js").Deps["sessions"], say?(text: string): void,
 * }} Deps
 *   `sessions` reads the rows of a console's read its cursor keeps (PG-22, rows/control.js).
 */

const OWN_PAGING = new Set(["LIMIT", "OFFSET", "FETCH", "FOR", "INTO", "PROCEDURE", "TOP"]);

/**
 * A console statement as one page of itself, or undefined when it cannot be paged.
 * @param {Statement} statement
 * @param {import("./sql/lexer.js").Dialect} dialect
 * @param {number} size
 * @param {number} offset
 */
export function pagedSql(statement, dialect, size, offset) {
  let depth = 0;
  /** @type {string[]} */
  const words = [];
  for (const token of statement.tokens) {
    if (token.type === "op" && token.text === "(") depth++;
    else if (token.type === "op" && token.text === ")") depth--;
    else if (token.type === "word" && depth === 0) words.push(token.text.toUpperCase());
  }
  if (words[0] !== "SELECT" && words[0] !== "WITH") return undefined;
  if (words[0] === "WITH" && !words.includes("SELECT")) return undefined;
  if (words.some((w) => OWN_PAGING.has(w))) return undefined;
  // On a line of its own, after a comment the statement may end with; one row more than the page
  // says whether another page follows.
  const text = `${statement.text}\nLIMIT ${size + 1} OFFSET ${offset}`;
  const [paged] = split(text, dialect);
  return paged
    ? { ...paged, start: statement.start, line: statement.line, column: statement.column }
    : undefined;
}

/** @param {Deps} deps */
export function createPages(deps) {
  /** The WHERE a table view runs: what the person typed, then the grid's quick filters. */
  const whereOf = (
    /** @type {NonNullable<Console["table"]>} */ page,
    /** @type {Connection} */ conn,
  ) => whereWith(engineOf(conn.engine).dialect, page.where, page.filters ?? []);

  const natural = createNaturalOrder(deps.execute);
  const rows = createRowsControl(deps);

  /**
   * Load a table view's page under its filter and order; without an order of the person's, in the
   * table's own (its primary key, table-order.js), so the rows keep their places when read again.
   */
  const refresh = async (/** @type {Console} */ target, /** @type {Connection} */ conn) => {
    const page = /** @type {NonNullable<Console["table"]>} */ (target.table);
    const limit = deps.settings().maxRows;
    const sql = tableSql(conn, {
      schema: page.schema,
      table: page.name,
      where: whereOf(page, conn),
      order: page.order.trim() || (await natural(conn, page)),
      limit,
      offset: page.offset,
    });
    return deps.run(target, conn, sql.page, { maxRows: limit, history: false });
  };

  /**
   * A table view's filter, order, sort keys, quick filters, page or count; a console's next or
   * previous page. `delta` pages forward or back. The grid's keys become the ORDER BY; an ORDER BY
   * typed otherwise drops them.
   * @param {Console} target
   * @param {Connection} conn
   * A console's read its cursor keeps pages by `rows` (as the grid scrolls), counts every row,
   * fetches every row (`all`), and takes the grid's keys and filters into the statement.
   * @param {{
   *   where?: string, order?: string, delta?: number, count?: boolean, all?: boolean,
   *   rows?: import("./rows/window.js").Way,
   *   sort?: import("./grid/filters.js").SortKey[] | null, filters?: import("./grid/filters.js").Filter[],
   * }} change
   */
  const page = async (target, conn, change) => {
    const limit = deps.settings().maxRows;
    if (target.kind === "console" && windowed(target)) {
      if (change.rows) return rows.scroll(target, conn, change.rows);
      if (change.count) return rows.count(target, conn);
      if (change.all) return rows.all(target, conn);
      if (change.sort !== undefined || change.filters !== undefined)
        return rows.shape(target, conn, change);
    }
    if (target.kind === "console") {
      const at = target.page;
      if (!at || !change.delta)
        throw new Error("Paging is for a table's view or a console's SELECT.");
      const offset = Math.max(0, at.offset + change.delta * limit);
      const statement = pagedSql(at.statement, engineOf(conn.engine).dialect, limit, offset);
      if (!statement) throw new Error("This statement pages itself (LIMIT, OFFSET or FETCH).");
      const said = await deps.run(target, conn, statement.text, {
        maxRows: limit,
        history: false,
        statements: [statement],
      });
      target.page = { statement: at.statement, offset };
      deps.render();
      return said;
    }
    const table = target.table;
    if (!table) throw new Error("Paging is for a table's view.");
    if (change.sort !== undefined) {
      table.sort = change.sort ?? [];
      change.order = orderSql(engineOf(conn.engine).dialect, table.sort);
    } else if (change.order !== undefined && change.order.trim() !== table.order.trim())
      table.sort = [];
    if (change.filters !== undefined) table.filters = change.filters;
    if (change.where !== undefined) table.where = change.where;
    if (change.order !== undefined) table.order = change.order;
    if (change.where !== undefined || change.order !== undefined || change.filters !== undefined) {
      table.offset = 0;
      table.count = null;
    }
    if (change.delta) table.offset = Math.max(0, table.offset + change.delta * limit);
    if (change.count) {
      const sql = tableSql(conn, {
        schema: table.schema,
        table: table.name,
        where: whereOf(table, conn),
        order: "",
        limit,
        offset: 0,
      });
      const counted = await deps.execute(conn, sql.count, { catalog: true });
      const value = counted.result.statements[0]?.sets[0]?.rows[0]?.[0];
      const error = counted.result.error ?? counted.result.statements[0]?.error;
      if (error) throw new Error(error.message);
      table.count = value === null || value === undefined ? null : Number(value);
      deps.render();
      return `${table.count === null ? "Unknown" : formatCount(table.count)} rows`;
    }
    return refresh(target, conn);
  };

  return { refresh, page };
}
