// Commands for Eris and agents, registered with an argument schema as agents' tools (ADR 0088): the
// connections (never a password) and what a connection holds, which only read, and a query. A
// query that only reads runs as asked; one that writes runs only after the person says yes,
// whatever the connection's tag, and a read-only connection refuses it as always. An agent is
// never shown a password prompt. On PostgreSQL both take another database of the connection's
// server (PG-13), and describing a connection also lists its server's databases.

import { homeOf, onDatabase } from "./databases.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./execute.js").Execution} Execution
 * @typedef {{
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">,
 *   commands: { on(name: string, handler: (args: unknown) => unknown): void },
 *   connections(): Connection[],
 *   find(ref: string): Connection | undefined,
 *   catalog: ReturnType<typeof import("./catalog.js").createCatalog>,
 *   execute: import("./catalog.js").Execute,
 * }} Deps
 */

const ROWS_DEFAULT = 100;
const ROWS_MAX = 1000;
const CONNECTION = { type: "string", minLength: 1, description: "A connection's name or id." };
const DATABASE = {
  type: "string",
  minLength: 1,
  description: "PostgreSQL: another database of the connection's server; its own by default.",
};

/** @param {Deps} deps */
export function createAgentCommands(deps) {
  /**
   * @param {string} id
   * @param {string} title
   * @param {string} description
   * @param {object} argsSchema
   * @param {(args: Record<string, unknown>) => unknown} run
   */
  const provide = (id, title, description, argsSchema, run) => {
    const reads = id !== "endue.database.query";
    const keywords = ["database", "sql"];
    const params = { id, title, description, keywords, argsSchema, agent: true };
    void deps.bridge
      .call("cmd.register", reads ? { ...params, readOnly: true } : params)
      .catch(() => {});
    deps.commands.on(id, (args) => run(/** @type {Record<string, unknown>} */ (args ?? {})));
  };

  /** The connection an agent names, on the database it names. */
  const named = (/** @type {unknown} */ ref, /** @type {unknown} */ database) => {
    const conn = typeof ref === "string" ? deps.find(ref) : undefined;
    if (!conn) throw new Error(`No connection is named ${String(ref)}.`);
    if (typeof database !== "string") return conn;
    if (conn.engine !== "postgresql")
      throw new Error(
        `${conn.name} is not PostgreSQL: a database of its own is a schema here, name it as schema.`,
      );
    return onDatabase(conn, database);
  };

  provide(
    "endue.database.connections",
    "Database: list connections",
    "The person's database connections: name, engine, where, environment tag, read-only. Never a password.",
    { type: "object", properties: {}, additionalProperties: false },
    () =>
      deps.connections().map((c) => ({
        id: c.id,
        name: c.name,
        engine: c.engine,
        ...(c.engine === "sqlite"
          ? { file: c.file }
          : { host: c.host, port: c.port, database: c.database, user: c.user }),
        tag: c.tag,
        readOnly: c.readOnly,
      })),
  );

  provide(
    "endue.database.schema",
    "Database: describe",
    "Without schema, the connection's schemas (and on PostgreSQL its server's databases); with schema, its tables and views; with table too, its columns. On PostgreSQL, database names another database of the server.",
    {
      type: "object",
      properties: {
        connection: CONNECTION,
        database: DATABASE,
        schema: { type: "string" },
        table: { type: "string" },
      },
      required: ["connection"],
      additionalProperties: false,
    },
    async (args) => {
      const conn = named(args.connection, args.database);
      const schema = typeof args.schema === "string" ? args.schema : undefined;
      if (schema === undefined) {
        const schemas = await deps.catalog.schemas(conn, true);
        if (conn.engine !== "postgresql") return { schemas };
        const databases = await deps.catalog.databases(homeOf(conn), true);
        return { schemas, databases: databases.map((d) => d.name) };
      }
      if (typeof args.table === "string")
        return { columns: await deps.catalog.columns(conn, schema, args.table, true) };
      return { tables: await deps.catalog.tables(conn, schema, true) };
    },
  );

  provide(
    "endue.database.query",
    "Database: run SQL",
    "Runs SQL on a connection (on PostgreSQL, on database when given) and answers each statement's columns and rows (maxRows each, 100 by default, 1000 at most), rows affected or error. Statements that change data run only after the person says yes.",
    {
      type: "object",
      properties: {
        connection: CONNECTION,
        database: DATABASE,
        sql: { type: "string", minLength: 1 },
        maxRows: { type: "integer", minimum: 1, maximum: ROWS_MAX },
      },
      required: ["connection", "sql"],
      additionalProperties: false,
    },
    async (args) => {
      const conn = named(args.connection, args.database);
      const maxRows =
        typeof args.maxRows === "number" ? Math.min(ROWS_MAX, args.maxRows) : ROWS_DEFAULT;
      const done = await deps.execute(conn, String(args.sql), {
        agent: true,
        interactive: false,
        maxRows,
      });
      return answerOf(done);
    },
  );
}

/** A run as an agent reads it. */
export function answerOf(/** @type {Execution} */ done) {
  const { result } = done;
  if (result.error) throw new Error(result.error.message);
  return {
    statements: result.statements.map((outcome, i) => ({
      statement: done.statements[i]?.text ?? "",
      ran: outcome.ran,
      ...(outcome.sets.length ? { results: outcome.sets } : {}),
      ...(outcome.affected !== null ? { affected: outcome.affected } : {}),
      ...(outcome.error
        ? {
            error: outcome.error.message,
            ...(outcome.error.code ? { code: outcome.error.code } : {}),
          }
        : {}),
    })),
    ms: result.ms,
  };
}
