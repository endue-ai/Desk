// What a connection holds, read from the engine's catalog: schemas (MySQL's databases, SQLite's
// main), their objects (tables, views, sequences, routines ..., schema/), a table's columns and
// parts (keys, foreign keys, indexes, triggers), the DDL of each, and exact row counts. Each answer
// is kept until a refresh, so the explorer opens folders without asking the server again, and what
// has been read is there at once for autocomplete (`snapshot`).

import { countSql, engineOf, pageSql } from "./engines/index.js";
import { objectsOf, partsOf, RELATIONS } from "./schema/common.js";
import { diagramOf, diagramQueries } from "./schema/diagram.js";
import { schemaOf } from "./schema/index.js";
import { qualified } from "./sql/quote.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./execute.js").Execution} Execution
 * @typedef {import("./execute.js").ExecuteOptions} ExecuteOptions
 * @typedef {import("./schema/common.js").SchemaObject} SchemaObject
 * @typedef {import("./schema/common.js").Part} Part
 * @typedef {{ name: string, type: string, rows?: number | null }} Table
 * @typedef {{ name: string, type: string, nullable: boolean, default: string | null, primary: boolean }} Column
 * @typedef {(conn: Connection, sql: string, options?: ExecuteOptions) => Promise<Execution>} Execute
 * @typedef {{ rows: (string | null)[][][], columns: string[][], failed?: { index: number, message: string } }} Many
 */

const CATALOG_ROWS = 10_000;
const SEP = "\u0000";

/** The schema a name without one is in: PostgreSQL's public, MySQL's database, SQLite's main. */
export function defaultSchema(/** @type {Connection} */ conn) {
  if (conn.engine === "sqlite") return "main";
  return conn.engine === "mysql" ? conn.database : "public";
}

/** An Error with the kind of the client's failure. */
const failure = (/** @type {{ message: string, kind?: string } | undefined} */ error) =>
  Object.assign(new Error(error?.message ?? "Not read."), { kind: error?.kind });

/**
 * @param {Execute} execute
 * @param {() => boolean} systemSchemas
 */
export function createCatalog(execute, systemSchemas) {
  /** @type {Map<string, Promise<unknown>>} */
  const cache = new Map();
  /** What each kept answer resolved to, for reading without waiting. */
  /** @type {Map<string, unknown>} */
  const done = new Map();

  /**
   * Catalog queries in one client run: each statement's rows and column names. A failure after
   * the first keeps what ran before it. `quiet` never asks for a password (an agent is reading).
   * @param {Connection} conn
   * @param {string[]} sqls
   * @returns {Promise<Many>}
   */
  const many = async (conn, sqls, quiet = false) => {
    const run = await execute(conn, sqls.join(";\n"), {
      catalog: true,
      maxRows: CATALOG_ROWS,
      ...(quiet ? { interactive: false } : {}),
    });
    const { result } = run;
    if (result.error) throw failure(result.error);
    const at = result.statements.findIndex((s) => s.error || !s.ran);
    const error = at >= 0 ? result.statements[at]?.error : undefined;
    if (at === 0) throw failure(error);
    const ran = at < 0 ? result.statements : result.statements.slice(0, at);
    return {
      rows: ran.map((s) => s.sets[0]?.rows ?? []),
      columns: ran.map((s) => s.sets[0]?.columns ?? []),
      ...(at >= 0 ? { failed: { index: at, message: error?.message ?? "Not read." } } : {}),
    };
  };
  const rows = async (/** @type {Connection} */ conn, /** @type {string} */ sql, quiet = false) =>
    (await many(conn, [sql], quiet)).rows[0] ?? [];

  /**
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} load
   * @returns {Promise<T>}
   */
  const kept = (key, load) => {
    let entry = /** @type {Promise<T> | undefined} */ (cache.get(key));
    if (!entry) {
      const made = load();
      entry = made;
      cache.set(key, made);
      made.then(
        (value) => {
          if (cache.get(key) === made) done.set(key, value);
        },
        () => cache.delete(key),
      );
    }
    return entry;
  };
  const keyOf = (/** @type {Connection} */ conn, /** @type {string[]} */ parts) =>
    [conn.id, ...parts].join(SEP);

  /** @returns {Promise<SchemaObject[]>} */
  const objects = (/** @type {Connection} */ conn, /** @type {string} */ schema, quiet = false) =>
    kept(keyOf(conn, ["objects", schema]), async () => {
      const read = await many(conn, schemaOf(conn.engine).objects(schema), quiet);
      return objectsOf(read.rows.flat(), schema);
    });

  /** @returns {Promise<Column[]>} */
  const columns = (
    /** @type {Connection} */ conn,
    /** @type {string} */ schema,
    /** @type {string} */ table,
    quiet = false,
  ) =>
    kept(keyOf(conn, ["columns", schema, table]), async () => {
      const sql = engineOf(conn.engine).catalog.columns(schema, table);
      return (await rows(conn, sql, quiet)).map((row) => ({
        name: row[0] ?? "",
        type: row[1] ?? "",
        nullable: row[2] === "YES",
        default: row[3] ?? null,
        primary: row[4] === "YES",
      }));
    });

  return {
    /** @returns {Promise<string[]>} */
    schemas: (/** @type {Connection} */ conn, quiet = false) =>
      kept(keyOf(conn, ["schemas"]), async () => {
        const sql = engineOf(conn.engine).catalog.schemas(systemSchemas());
        return (await rows(conn, sql, quiet)).map((row) => row[0] ?? "");
      }),
    objects,
    /** A schema's tables and views, as agents read them. @returns {Promise<Table[]>} */
    tables: async (/** @type {Connection} */ conn, /** @type {string} */ schema, quiet = false) =>
      (await objects(conn, schema, quiet))
        .filter((o) => RELATIONS.has(o.kind))
        .map((o) => ({ name: o.name, type: o.kind, rows: o.rows })),
    columns,
    /** A table's keys, foreign keys, indexes and triggers. @returns {Promise<Part[]>} */
    parts: (
      /** @type {Connection} */ conn,
      /** @type {string} */ schema,
      /** @type {string} */ table,
    ) =>
      kept(keyOf(conn, ["parts", schema, table]), async () => {
        const read = await many(conn, schemaOf(conn.engine).parts(schema, table));
        return partsOf(read.rows.flat(), { schema, name: table });
      }),
    /** The DDL of an object or a part, read afresh each time. */
    ddl: async (/** @type {Connection} */ conn, /** @type {SchemaObject | Part} */ object) => {
      const engine = schemaOf(conn.engine);
      const queries = engine.ddlQueries(object);
      if (queries.length === 0) return engine.ddl(object, []);
      const read = await many(conn, queries);
      if (read.failed) throw new Error(read.failed.message);
      return engine.ddl(object, read.rows, read.columns);
    },
    /** Exact row counts of tables, in one run; a table that could not be counted is null. */
    count: async (
      /** @type {Connection} */ conn,
      /** @type {string} */ schema,
      /** @type {string[]} */ tables,
    ) => {
      const sqls = tables.map((t) => countSql(tableName(conn, schema, t), ""));
      const read = await many(conn, sqls);
      return tables.map((_, i) => {
        const value = read.rows[i]?.[0]?.[0];
        return value === null || value === undefined ? null : Number(value);
      });
    },
    /** A schema's tables, columns and foreign keys, for its ER diagram, read afresh. */
    diagram: async (/** @type {Connection} */ conn, /** @type {string} */ schema) => {
      const read = await many(conn, diagramQueries(conn.engine, schema));
      return diagramOf(read.rows[0] ?? [], read.rows[1] ?? []);
    },
    /** What has been read of a connection, without waiting: for autocomplete. */
    snapshot(/** @type {Connection} */ conn) {
      const get = (/** @type {string[]} */ parts) => done.get(keyOf(conn, parts));
      return {
        defaultSchema: defaultSchema(conn),
        schemas: () => /** @type {string[] | undefined} */ (get(["schemas"])) ?? [],
        tables: (/** @type {string} */ schema) =>
          /** @type {SchemaObject[] | undefined} */ (get(["objects", schema]))
            ?.filter((o) => RELATIONS.has(o.kind))
            .map((o) => ({ name: o.name, type: o.kind })),
        columns: (/** @type {string} */ schema, /** @type {string} */ table) =>
          /** @type {Column[] | undefined} */ (get(["columns", schema, table])),
      };
    },
    /** Forget what was read for one connection (under `prefix`, one schema say), or for all. */
    forget(/** @type {string | undefined} */ connection, /** @type {string[]} */ prefix = []) {
      const start = connection === undefined ? "" : [connection, ...prefix].join(SEP);
      for (const map of [cache, done])
        for (const key of [...map.keys()]) if (key.startsWith(start)) map.delete(key);
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
