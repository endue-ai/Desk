// Handlers for the agent tools declared in plugin.json (ADR 0088): the
// connections (never a password) and what a connection holds, which only read, and a query. A
// query that only reads runs as asked; one that writes runs only after the person says yes,
// whatever the connection's tag, and a read-only connection refuses it as always. An agent is
// never shown a password prompt. On PostgreSQL both take another database of the connection's
// server (PG-13), and describing a connection also lists its server's databases. A connection
// closed to agents is not listed, and a query runs as an agent's (features/audit/: read-only,
// limited, masked, a write asked for this run only, every call on the audit list).

import { readView } from "./agent-view.js";
import { homeOf, onDatabase } from "./databases.js";
import { countChanges, deleteRows, editCell } from "./edit/pending.js";
import { agentsOf } from "./features/audit/agents.js";
import { keepable, readHistory } from "./history.js";
import { t } from "./strings/index.js";

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
 *   consoles: ReturnType<typeof import("./consoles.js").createConsoles>,
 *   view: import("./database.js").View,
 * }} Deps
 */

const ROWS_DEFAULT = 100;
const ROWS_MAX = 1000;
/** @param {Deps} deps */
export function createAgentCommands(deps) {
  const agents = agentsOf(deps.bridge);
  /** @param {string} id @param {(args: Record<string, unknown>) => unknown} run */
  const provide = (id, run) => {
    deps.commands.on(id, (args) => run(/** @type {Record<string, unknown>} */ (args ?? {})));
  };

  /** The connection an agent names, on the database it names. */
  const named = (/** @type {unknown} */ ref, /** @type {unknown} */ database) => {
    const conn = typeof ref === "string" ? deps.find(ref) : undefined;
    if (!conn) throw new Error(t("agent.noConnectionIsNamed", { value: String(String(ref)) }));
    if (typeof database !== "string") return conn;
    if (conn.engine !== "postgresql")
      throw new Error(t("agent.isNotPostgresqlADatabaseOf", { name: String(conn.name) }));
    return onDatabase(conn, database);
  };

  const stage = async (/** @type {Parameters<Deps["consoles"]["edits"]["step"]>[1]} */ apply) => {
    const target = deps.consoles.current();
    const conn = target && deps.find(target.connection);
    if (!target || !conn) throw new Error(t("agent.showTheResultToChange"));
    if ((await agents?.access.of(conn.id))?.closed)
      throw new Error(t("agent.isClosedToAgents", { name: String(conn.name) }));
    const { state } = await deps.consoles.edits.ready();
    if (deps.consoles.current() !== target)
      throw new Error(t("agent.theResultOnScreenChangedMeanwhile"));
    return deps.consoles.edits.step(state, (changes, table, set) => {
      apply(changes, table, set);
      return { pending: countChanges(changes) };
    });
  };

  provide("endue.database.connections", async () =>
    (agents ? await agents.visible(deps.connections()) : deps.connections()).map((c) => ({
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

  provide("endue.database.schema", async (args) => {
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
  });

  provide("endue.database.query", async (args) => {
    const conn = named(args.connection, args.database);
    if (agents) return answerOf(await agents.query(conn, String(args.sql), args));
    const maxRows =
      typeof args.maxRows === "number" ? Math.min(ROWS_MAX, args.maxRows) : ROWS_DEFAULT;
    const done = await deps.execute(conn, String(args.sql), {
      agent: true,
      interactive: false,
      maxRows,
    });
    return answerOf(done);
  });

  provide("endue.database.view-state", async (args) => {
    const target = deps.consoles.current();
    const conn = target && deps.find(target.connection);
    if (!target || !conn) return null;
    const access = await agents?.access.of(conn.id);
    if (access?.closed) throw new Error(t("agent.isClosedToAgents", { name: String(conn.name) }));
    const maxRows = agents?.limits({ maxRows: args.maxRows }).maxRows ?? ROWS_DEFAULT;
    return readView(target, conn, deps.view, args.include, maxRows, access?.sensitive ?? []);
  });

  provide("endue.database.write-console", async (args) => {
    const conn = named(args.connection, args.database);
    if (typeof args.sql !== "string" || !args.sql.trim())
      throw new Error(t("agent.giveTheSqlToDraft"));
    const target =
      args.newTab === true ? await deps.consoles.openNew(conn) : await deps.consoles.open(conn);
    const before = deps.view.editor().text;
    const separator = before.trimEnd().endsWith(";") ? "\n\n" : "\n;\n\n";
    const text = before.trim() ? before + separator + args.sql : args.sql;
    deps.view.replace(0, before.length, text);
    deps.consoles.edited(text);
    deps.view.focus("editor");
    return { connection: conn.id, buffer: target.id, drafted: true };
  });

  provide("endue.database.history-list", async (args) => {
    const conn = named(args.connection, args.database);
    const limit = typeof args.limit === "number" ? Math.min(100, Math.max(1, args.limit)) : 30;
    const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
    const history = (await readHistory(deps.bridge, conn.id))
      .filter(
        ({ sql, database }) =>
          keepable(sql) &&
          sql.toLowerCase().includes(query) &&
          (typeof args.database !== "string" || database === args.database),
      )
      .slice(0, limit);
    return { history };
  });
  provide("endue.database.stage-cells", ({ cells }) => {
    if (!Array.isArray(cells) || cells.length < 1 || cells.length > 100)
      throw new Error(t("agent.giveOneToCellsToStage"));
    return stage((changes, table, set) => {
      for (const { row, column, value } of cells) {
        if (
          !Number.isInteger(row) ||
          row < 0 ||
          !Number.isInteger(column) ||
          column < 0 ||
          (value !== null && typeof value !== "string")
        )
          throw new Error(t("agent.useResultRowAndColumnIndices"));
        editCell(changes, table, set, row, column, value);
      }
    });
  });
  provide("endue.database.stage-delete-rows", ({ rows }) => {
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100)
      throw new Error(t("agent.giveOneToRowsToStage"));
    return stage((changes, table, set) => {
      if (
        rows.some(
          (row) =>
            !Number.isInteger(row) || row < 0 || row >= set.rows.length + changes.inserts.length,
        )
      )
        throw new Error(t("agent.useIndicesOfRowsInThe"));
      deleteRows(changes, table, set, rows);
    });
  });
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
