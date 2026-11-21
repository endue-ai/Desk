// What a connection holds, read from the engine's catalog: schemas (MySQL's databases, SQLite's
// main), their objects (tables, views, sequences, routines ..., schema/), a table's columns and
// parts (keys, foreign keys, indexes, triggers), the DDL of each, and exact row counts. PostgreSQL's
// come from the schema cache (schema-cache/, ADR 0285), kept on disk and refreshed by what changed;
// what it does not hold (a schema not chosen, a table made since its last check) and the other
// engines' are read when asked and kept until a refresh, so the explorer opens folders without
// asking the server again, and what has been read is there at once for autocomplete (`snapshot`).

import { countSql, engineOf, pageSql } from "./engines/index.js";
import { objectsOf, partsOf, RELATIONS } from "./schema/common.js";
import { diagramOf, diagramQueries } from "./schema/diagram.js";
import { schemaOf } from "./schema/index.js";
import { createSchemaCache, ranDdl } from "./schema-cache/index.js";
import { qualified } from "./sql/quote.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./execute.js").Execution} Execution
 * @typedef {import("./execute.js").ExecuteOptions} ExecuteOptions
 * @typedef {import("./schema/common.js").SchemaObject} SchemaObject
 * @typedef {import("./schema/common.js").Part} Part
 * @typedef {{ name: string, type: string, rows?: number | null }} Table
 * @typedef {{ name: string, type: string, nullable: boolean, default: string | null, primary: boolean, comment?: string }} Column
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

/** A store in memory, for a catalog nobody keeps. */
const memoryStore = () => {
  /** @type {Map<string, unknown>} */
  const values = new Map();
  return {
    get: async (/** @type {string} */ key) => values.get(key),
    set: async (/** @type {string} */ key, /** @type {unknown} */ value) => {
      values.set(key, value);
    },
  };
};

/**
 * @param {Execute} execute
 * @param {() => boolean} systemSchemas
 * @param {{ store?: import("./schema-cache/store.js").Store, changed?(connection: string): void, now?(): number }} [options]
 *   `store` keeps the schema cache (the plugin's store); `changed` hears that what a connection
 *   holds changed (a cache read, a DDL statement ran), so the explorer reads it again.
 */
export function createCatalog(execute, systemSchemas, options = {}) {
  const changed = (/** @type {string} */ connection) => options.changed?.(connection);
  const cache = createSchemaCache({
    execute,
    store: options.store ?? memoryStore(),
    systemSchemas,
    changed,
    ...(options.now ? { now: options.now } : {}),
  });
  /** The cache's answers once it is in memory, or undefined for an engine it does not hold. */
  const held = async (/** @type {Connection} */ conn, quiet = false) => {
    if (!cache.cached(conn)) return undefined;
    await cache.open(conn, quiet);
    return cache.view(conn);
  };
  /** What was read on demand, by connection and node. @type {Map<string, Promise<unknown>>} */
  const reads = new Map();
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
    let entry = /** @type {Promise<T> | undefined} */ (reads.get(key));
    if (!entry) {
      const made = load();
      entry = made;
      reads.set(key, made);
      made.then(
        (value) => {
          if (reads.get(key) === made) done.set(key, value);
        },
        () => reads.delete(key),
      );
    }
    return entry;
  };
  const keyOf = (/** @type {Connection} */ conn, /** @type {string[]} */ parts) =>
    [conn.id, ...parts].join(SEP);

  /** @returns {Promise<SchemaObject[]>} */
  const readObjects = (
    /** @type {Connection} */ conn,
    /** @type {string} */ schema,
    quiet = false,
  ) =>
    kept(keyOf(conn, ["objects", schema]), async () => {
      const read = await many(conn, schemaOf(conn.engine).objects(schema), quiet);
      return objectsOf(read.rows.flat(), schema);
    });

  /** @returns {Promise<Column[]>} */
  const readColumns = (
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

  /** @returns {Promise<SchemaObject[]>} */
  const objects = async (
    /** @type {Connection} */ conn,
    /** @type {string} */ schema,
    quiet = false,
  ) => (await held(conn, quiet))?.objects(schema) ?? readObjects(conn, schema, quiet);

  /** @returns {Promise<Column[]>} */
  const columns = async (
    /** @type {Connection} */ conn,
    /** @type {string} */ schema,
    /** @type {string} */ table,
    quiet = false,
  ) => (await held(conn, quiet))?.columns(schema, table) ?? readColumns(conn, schema, table, quiet);

  /** Forget what was read on demand for one connection (under `prefix`, one schema say), or for all. */
  const forget = (
    /** @type {string | undefined} */ connection,
    /** @type {string[]} */ prefix = [],
  ) => {
    const start = connection === undefined ? "" : [connection, ...prefix].join(SEP);
    for (const map of [reads, done])
      for (const key of [...map.keys()]) if (key.startsWith(start)) map.delete(key);
  };

  return {
    /** The schema cache itself, for what catalog.js does not answer (schema-cache/README.md). */
    cache,
    /** @returns {Promise<string[]>} */
    schemas: async (/** @type {Connection} */ conn, quiet = false) =>
      (await held(conn, quiet))?.listed() ??
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
    parts: async (
      /** @type {Connection} */ conn,
      /** @type {string} */ schema,
      /** @type {string} */ table,
    ) =>
      (await held(conn))?.parts(schema, table) ??
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
    /** A schema's tables, columns and foreign keys, for its ER diagram: cached, or read afresh. */
    diagram: async (/** @type {Connection} */ conn, /** @type {string} */ schema) => {
      const view = await held(conn);
      if (view?.held(schema)) return diagramOf(...diagramRows(view, schema));
      const read = await many(conn, diagramQueries(conn.engine, schema));
      return diagramOf(read.rows[0] ?? [], read.rows[1] ?? []);
    },
    /** What has been read of a connection, without waiting: for autocomplete. */
    snapshot(/** @type {Connection} */ conn) {
      const get = (/** @type {string[]} */ parts) => done.get(keyOf(conn, parts));
      const view = cache.view(conn);
      return {
        defaultSchema: defaultSchema(conn),
        schemas: () =>
          view?.listed() ?? /** @type {string[] | undefined} */ (get(["schemas"])) ?? [],
        tables: (/** @type {string} */ schema) =>
          (
            view?.objects(schema) ??
            /** @type {SchemaObject[] | undefined} */ (get(["objects", schema]))
          )
            ?.filter((o) => RELATIONS.has(o.kind))
            .map((o) => ({ name: o.name, type: o.kind })),
        columns: (/** @type {string} */ schema, /** @type {string} */ table) =>
          view?.columns(schema, table) ??
          /** @type {Column[] | undefined} */ (get(["columns", schema, table])),
      };
    },
    /** The schema cache's answers and state for a connection (PostgreSQL), or undefined. */
    status: (/** @type {Connection} */ conn) => cache.view(conn),
    /**
     * Read again what a refresh in the explorer names: the cache reads the schema, or every chosen
     * one; what was read on demand is forgotten under it.
     * @param {string | undefined} connection
     * @param {string} [schema]
     * @param {string} [table]
     */
    refresh(connection, schema, table) {
      if (schema === undefined) forget(connection);
      else if (table !== undefined)
        for (const what of ["columns", "parts"]) forget(connection, [what, schema, table]);
      else for (const what of ["objects", "columns", "parts"]) forget(connection, [what, schema]);
      for (const conn of cache.opened())
        if (connection === undefined || conn.id === connection)
          cache
            .refresh(conn, schema === undefined ? { all: true } : { schemas: [schema] })
            .catch(() => {});
    },
    /** A run of the plugin's own ended: a DDL statement in it reads again what it touched. */
    ran(/** @type {Execution} */ execution) {
      const { conn } = execution;
      if (cache.cached(conn)) return cache.ran(conn, execution);
      if (!ranDdl(execution)) return false;
      forget(conn.id);
      changed(conn.id);
      return true;
    },
    /** Stop the schema cache's passes (of one connection, or of all). */
    cancel: (/** @type {string | undefined} */ connection) => cache.cancel(connection),
    /** A connection was removed: forget everything of it, the cache on disk too. */
    async drop(/** @type {string} */ connection) {
      forget(connection);
      await cache.drop(connection);
    },
    forget,
  };
}

/** The rows `diagramOf` reads, from the cache: tables' columns and the foreign keys inside the schema. */
function diagramRows(
  /** @type {import("./schema-cache/view.js").CacheView} */ view,
  /** @type {string} */ schema,
) {
  const tables = (view.objects(schema) ?? []).filter((o) => o.kind === "table");
  /** @type {(string | null)[][]} */
  const columns = [];
  /** @type {(string | null)[][]} */
  const keys = [];
  for (const table of tables) {
    for (const c of view.columns(schema, table.name) ?? [])
      columns.push([table.name, c.name, c.type, c.primary ? "YES" : "NO"]);
    for (const k of view.foreignKeys(schema, table.name) ?? [])
      if (k.schema === schema)
        keys.push([table.name, k.name, k.columns.join(", "), k.table, k.refColumns.join(", ")]);
  }
  return /** @type {const} */ ([columns, keys]);
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
