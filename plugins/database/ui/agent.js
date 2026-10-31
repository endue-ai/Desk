// Commands for Eris and agents, registered with an argument schema: the connections (never a
// password), what a connection holds, and a query. A query that only reads runs as asked; one that
// writes runs only after the person says yes, whatever the connection's tag, and a read-only
// connection refuses it as always. An agent is never shown a password prompt.

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
    void deps.bridge
      .call("cmd.register", { id, title, description, keywords: ["database", "sql"], argsSchema })
      .catch(() => {});
    deps.commands.on(id, (args) => run(/** @type {Record<string, unknown>} */ (args ?? {})));
  };

  const named = (/** @type {unknown} */ ref) => {
    const conn = typeof ref === "string" ? deps.find(ref) : undefined;
    if (!conn) throw new Error(`No connection is named ${String(ref)}.`);
    return conn;
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
    "Without schema, the connection's schemas; with schema, its tables and views; with table too, its columns.",
    {
      type: "object",
      properties: { connection: CONNECTION, schema: { type: "string" }, table: { type: "string" } },
      required: ["connection"],
      additionalProperties: false,
    },
    async (args) => {
      const conn = named(args.connection);
      const schema = typeof args.schema === "string" ? args.schema : undefined;
      if (schema === undefined) return { schemas: await deps.catalog.schemas(conn, true) };
      if (typeof args.table === "string")
        return { columns: await deps.catalog.columns(conn, schema, args.table, true) };
      return { tables: await deps.catalog.tables(conn, schema, true) };
    },
  );

  provide(
    "endue.database.query",
    "Database: run SQL",
    "Runs SQL on a connection and answers each statement's columns and rows (maxRows each, 100 by default, 1000 at most), rows affected or error. Statements that change data run only after the person says yes.",
    {
      type: "object",
      properties: {
        connection: CONNECTION,
        sql: { type: "string", minLength: 1 },
        maxRows: { type: "integer", minimum: 1, maximum: ROWS_MAX },
      },
      required: ["connection", "sql"],
      additionalProperties: false,
    },
    async (args) => {
      const conn = named(args.connection);
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
