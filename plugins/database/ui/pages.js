// Results a page at a time. A table's view pages through its rows under the filter and order the
// person typed (WHERE, ORDER BY, LIMIT, OFFSET), counts them on request, and sorts on the server
// when a column's header is picked. A console's single SELECT pages the same way when it has no
// LIMIT, OFFSET, FETCH, FOR or INTO of its own: the next page runs it again with LIMIT and OFFSET.

import { tableSql } from "./catalog.js";
import { engineOf } from "./engines/index.js";
import { formatCount } from "./format.js";
import { quoteName } from "./sql/quote.js";
import { split } from "./sql/split.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./consoles.js").Console} Console
 * @typedef {import("./sql/split.js").Statement} Statement
 * @typedef {{
 *   settings(): import("./settings.js").Settings,
 *   run(target: Console, conn: Connection, sql: string, options: { maxRows?: number, history?: boolean, statements?: Statement[] }): Promise<string>,
 *   execute: import("./catalog.js").Execute,
 *   render(): void,
 * }} Deps
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
  /** Load a table view's page under its filter and order. */
  const refresh = async (/** @type {Console} */ target, /** @type {Connection} */ conn) => {
    const page = /** @type {NonNullable<Console["table"]>} */ (target.table);
    const limit = deps.settings().maxRows;
    const sql = tableSql(conn, {
      schema: page.schema,
      table: page.name,
      where: page.where,
      order: page.order,
      limit,
      offset: page.offset,
    });
    return deps.run(target, conn, sql.page, { maxRows: limit, history: false });
  };

  /**
   * A table view's filter, order, sort by a column, page or count; a console's next or previous
   * page. `delta` pages forward or back.
   * @param {Console} target
   * @param {Connection} conn
   * @param {{ where?: string, order?: string, delta?: number, count?: boolean, sort?: { column: string, direction: "asc" | "desc" } | null }} change
   */
  const page = async (target, conn, change) => {
    const limit = deps.settings().maxRows;
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
      const { dialect } = engineOf(conn.engine);
      change.order = change.sort
        ? `${quoteName(dialect, change.sort.column)} ${change.sort.direction.toUpperCase()}`
        : "";
    }
    if (change.where !== undefined) table.where = change.where;
    if (change.order !== undefined) table.order = change.order;
    if (change.where !== undefined || change.order !== undefined) {
      table.offset = 0;
      table.count = null;
    }
    if (change.delta) table.offset = Math.max(0, table.offset + change.delta * limit);
    if (change.count) {
      const sql = tableSql(conn, {
        schema: table.schema,
        table: table.name,
        where: table.where,
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
