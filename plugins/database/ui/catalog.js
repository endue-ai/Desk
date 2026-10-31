// What a connection holds, read from the engine's catalog: schemas (MySQL's databases, SQLite's
// main), their tables and views, a table's columns. Each answer is kept until a refresh, so the
// explorer opens folders without asking the server again.

import { countSql, engineOf, pageSql } from "./engines/index.js";
import { qualified } from "./sql/quote.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./execute.js").Execution} Execution
 * @typedef {import("./execute.js").ExecuteOptions} ExecuteOptions
 * @typedef {{ name: string, type: string }} Table
 * @typedef {{ name: string, type: string, nullable: boolean, default: string | null, primary: boolean }} Column
 * @typedef {(conn: Connection, sql: string, options?: ExecuteOptions) => Promise<Execution>} Execute
 */

const CATALOG_ROWS = 10_000;

/**
 * @param {Execute} execute
 * @param {() => boolean} systemSchemas
 */
export function createCatalog(execute, systemSchemas) {
  /** @type {Map<string, Promise<unknown>>} */
  const cache = new Map();

  /** The rows of one catalog query, or an Error with the client's words. */
  /** `quiet` never asks for a password (an agent is reading). */
  const rows = async (/** @type {Connection} */ conn, /** @type {string} */ sql, quiet = false) => {
    const done = await execute(conn, sql, {
      catalog: true,
      maxRows: CATALOG_ROWS,
      ...(quiet ? { interactive: false } : {}),
    });
    const outcome = done.result.statements[0];
    const error = done.result.error ?? outcome?.error;
    if (error) throw Object.assign(new Error(error.message), { kind: error.kind });
    return outcome?.sets[0]?.rows ?? [];
  };

  /**
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} load
   * @returns {Promise<T>}
   */
  const kept = (key, load) => {
    let entry = /** @type {Promise<T> | undefined} */ (cache.get(key));
    if (!entry) {
      entry = load();
      cache.set(key, entry);
      entry.catch(() => cache.delete(key));
    }
    return entry;
  };

  return {
    /** @returns {Promise<string[]>} */
    schemas: (/** @type {Connection} */ conn, quiet = false) =>
      kept(`${conn.id}\u0000schemas`, async () => {
        const sql = engineOf(conn.engine).catalog.schemas(systemSchemas());
        return (await rows(conn, sql, quiet)).map((row) => row[0] ?? "");
      }),
    /** @returns {Promise<Table[]>} */
    tables: (/** @type {Connection} */ conn, /** @type {string} */ schema, quiet = false) =>
      kept(`${conn.id}\u0000tables\u0000${schema}`, async () => {
        const sql = engineOf(conn.engine).catalog.tables(schema);
        return (await rows(conn, sql, quiet)).map((row) => ({
          name: row[0] ?? "",
          type: row[1] ?? "table",
        }));
      }),
    /** @returns {Promise<Column[]>} */
    columns: (
      /** @type {Connection} */ conn,
      /** @type {string} */ schema,
      /** @type {string} */ table,
      quiet = false,
    ) =>
      kept(`${conn.id}\u0000columns\u0000${schema}\u0000${table}`, async () => {
        const sql = engineOf(conn.engine).catalog.columns(schema, table);
        return (await rows(conn, sql, quiet)).map((row) => ({
          name: row[0] ?? "",
          type: row[1] ?? "",
          nullable: row[2] === "YES",
          default: row[3] ?? null,
          primary: row[4] === "YES",
        }));
      }),
    /** Forget what was read for one connection, or for all. */
    forget(/** @type {string | undefined} */ connection) {
      for (const key of [...cache.keys()])
        if (connection === undefined || key.startsWith(`${connection}\u0000`)) cache.delete(key);
    },
  };
}

/** A table's name as SQL: schema-qualified, except SQLite's main. */
export function tableName(
  /** @type {Connection} */ conn,
  /** @type {string} */ schema,
  /** @type {string} */ table,
) {
  const { dialect } = engineOf(conn.engine);
  return qualified(dialect, conn.engine === "sqlite" ? "" : schema, table);
}

/**
 * The SQL of a table's page and of its count, after checking that the filter and the order are each
 * one expression: no `;` and no unbalanced parenthesis can carry a second statement in.
 * @param {Connection} conn
 * @param {{ schema: string, table: string, where: string, order: string, limit: number, offset: number }} page
 */
export function tableSql(conn, page) {
  for (const [label, text] of /** @type {const} */ ([
    ["Filter", page.where],
    ["Order", page.order],
  ]))
    if (!oneExpression(text))
      throw new Error(`${label}: one expression, without ; or unbalanced parentheses.`);
  const from = tableName(conn, page.schema, page.table);
  return {
    page: pageSql(from, page),
    count: countSql(from, page.where),
  };
}

/** Whether text outside quotes has no `;` and balanced parentheses. */
export function oneExpression(/** @type {string} */ text) {
  let depth = 0;
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = /** @type {string} */ (text[i]);
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth < 0) return false;
    else if (c === ";" || (c === "-" && text[i + 1] === "-") || (c === "/" && text[i + 1] === "*"))
      return false;
  }
  return depth === 0 && quote === "";
}
