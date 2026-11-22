// The agents' read tools (PG-91): explain a statement (ANALYZE only where the person allows it, and
// only of a read), an object's DDL, a table's first rows, a table's statistics, the server's
// sessions, and a check of a statement without running it. Each runs as an agent's read (run.js:
// read-only, limited, masked) and answers plain data; the gate (gate.js) refuses a connection closed
// to agents before any of them starts. No DOM.

import { onDatabase } from "../../databases.js";
import { engineOf } from "../../engines/index.js";
import { classify, readsOnly } from "../../sql/classify.js";
import { split } from "../../sql/split.js";
import { MASK, namesOn } from "./mask.js";
import { readOnly } from "./run.js";
import {
  checkPosition,
  checkSql,
  explainSql,
  objectsOf,
  PREPARED,
  SESSIONS_SQL,
  sampleSql,
  statsSql,
} from "./sql.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {ReturnType<typeof import("./agents.js").createAgents>} Agents
 */

const SAMPLE_DEFAULT = 20;

/** The text of a run's failure, if any. */
const failureOf = (/** @type {import("../../execute.js").Execution} */ done) =>
  done.result.error?.message ?? done.result.statements.find((s) => s.error)?.error?.message ?? "";

/**
 * @param {Deps} deps
 * @param {Agents} agents
 */
export function agentTools(deps, agents) {
  /** The connection an agent names, on the database it names (PostgreSQL). */
  const named = (/** @type {unknown} */ ref, /** @type {unknown} */ database) => {
    const conn = typeof ref === "string" ? deps.manager.get(ref) : undefined;
    if (!conn) throw new Error(`No connection is named ${String(ref)}.`);
    if (typeof database !== "string" || !database) return conn;
    if (conn.engine !== "postgresql")
      throw new Error(`${conn.name} is not PostgreSQL: name its schema instead of a database.`);
    return onDatabase(conn, database);
  };
  const postgres = (/** @type {Connection} */ conn, /** @type {string} */ what) => {
    if (conn.engine !== "postgresql")
      throw new Error(
        `${what} reads PostgreSQL's catalog: ${conn.name} is a ${engineOf(conn.engine).title} connection.`,
      );
  };
  /** The one statement an agent hands in. */
  const one = (/** @type {Connection} */ conn, /** @type {unknown} */ sql) => {
    const dialect = engineOf(conn.engine).dialect;
    const statements = split(typeof sql === "string" ? sql : "", dialect);
    if (statements.length !== 1)
      throw new Error(`Hand in one statement: this SQL holds ${statements.length}.`);
    const statement = /** @type {import("../../sql/split.js").Statement} */ (statements[0]);
    return { text: statement.text, class: classify(statement, dialect) };
  };
  const text = (/** @type {unknown} */ value, /** @type {string} */ what) => {
    if (typeof value !== "string" || !value) throw new Error(`Name the ${what}.`);
    return value;
  };

  return {
    "endue.database.explain-statement": async (/** @type {Record<string, unknown>} */ args) => {
      const conn = named(args.connection, args.database);
      const statement = one(conn, args.sql);
      const analyze = args.analyze === true;
      if (analyze) {
        if (!(await agents.access.of(conn.id)).analyze)
          throw new Error(
            `EXPLAIN ANALYZE runs the statement: the person has not allowed it for agents on ${conn.name}.`,
          );
        if (conn.engine === "sqlite") throw new Error("SQLite has no EXPLAIN ANALYZE.");
        if (!readsOnly([statement.class]))
          throw new Error(
            `EXPLAIN ANALYZE runs the statement, and an agent's runs only a read: this one is ${statement.class.verb}.`,
          );
      }
      const sql = explainSql(conn.engine, statement.text, analyze);
      const done = await agents.runs.read(conn, sql, {
        args,
        command: "endue.database.explain-statement",
        rows: 1000,
        limits: { timeoutSeconds: args.timeoutSeconds },
        names: new Set(),
      });
      const failed = failureOf(done);
      if (failed) throw new Error(failed);
      const set = done.result.statements[0]?.sets[0];
      if (conn.engine === "postgresql")
        return { plan: (set?.rows ?? []).map((r) => r[0] ?? "").join("\n"), analyzed: analyze };
      return { plan: objectsOf(set), analyzed: analyze };
    },

    "endue.database.object-ddl": async (/** @type {Record<string, unknown>} */ args) => {
      const conn = named(args.connection, args.database);
      const schema = conn.engine === "sqlite" ? "main" : text(args.schema, "schema");
      const name = text(args.name, "object");
      const objects = await deps.catalog.objects(readOnly(conn), schema, true);
      const kind = typeof args.kind === "string" ? args.kind : "";
      const object = objects.find((o) => o.name === name && (!kind || o.kind === kind));
      if (!object) throw new Error(`${schema} has no ${kind || "object"} named ${name}.`);
      const ddl = await deps.catalog.ddl(readOnly(conn), object);
      agents.gate.note(args, "endue.database.object-ddl", {
        connection: conn.id,
        statement: `DDL of ${object.kind} ${schema}.${name}`,
        rows: null,
        asked: false,
        allowed: null,
        outcome: "ran",
      });
      return { kind: object.kind, ddl };
    },

    "endue.database.sample-rows": async (/** @type {Record<string, unknown>} */ args) => {
      const conn = named(args.connection, args.database);
      const schema = conn.engine === "sqlite" ? "main" : text(args.schema, "schema");
      const table = text(args.table, "table");
      const { sensitive } = await agents.access.of(conn.id);
      const names = namesOn(sensitive, schema, table);
      const limits = { maxRows: args.limit, timeoutSeconds: args.timeoutSeconds };
      const { maxRows } = agents.limits(limits, SAMPLE_DEFAULT);
      const sql = sampleSql(conn, schema, table, maxRows);
      const done = await agents.runs.read(conn, sql, {
        args,
        command: "endue.database.sample-rows",
        limits,
        rows: SAMPLE_DEFAULT,
        names,
      });
      const failed = failureOf(done);
      if (failed) throw new Error(failed);
      const set = done.result.statements[0]?.sets[0];
      return {
        columns: set?.columns ?? [],
        rows: set?.rows ?? [],
        masked: (set?.columns ?? []).filter((c) => names.has(c.toLowerCase())),
      };
    },

    "endue.database.table-stats": async (/** @type {Record<string, unknown>} */ args) => {
      const conn = named(args.connection, args.database);
      postgres(conn, "A table's statistics");
      const schema = text(args.schema, "schema");
      const table = text(args.table, "table");
      const done = await agents.runs.read(conn, statsSql(schema, table).join(";\n"), {
        args,
        command: "endue.database.table-stats",
        single: true,
        rows: 1000,
        limits: { timeoutSeconds: args.timeoutSeconds },
        names: new Set(),
      });
      const failed = failureOf(done);
      if (failed) throw new Error(failed);
      const [size, columns] = done.result.statements.map((s) => objectsOf(s.sets[0]));
      if (!size?.[0]) throw new Error(`${schema} has no table named ${table}.`);
      const names = namesOn((await agents.access.of(conn.id)).sensitive, schema, table);
      const hidden = ["most_common_vals", "histogram_bounds"];
      return {
        table: size[0],
        columns: (columns ?? []).map((c) =>
          names.has(String(c.attname).toLowerCase())
            ? { ...c, ...Object.fromEntries(hidden.map((k) => [k, c[k] === null ? null : MASK])) }
            : c,
        ),
      };
    },

    "endue.database.sessions-list": async (/** @type {Record<string, unknown>} */ args) => {
      const conn = named(args.connection, undefined);
      postgres(conn, "The sessions list");
      const done = await agents.runs.read(conn, SESSIONS_SQL, {
        args,
        command: "endue.database.sessions-list",
        rows: 1000,
        limits: { maxRows: args.limit, timeoutSeconds: args.timeoutSeconds },
        names: new Set(),
      });
      const failed = failureOf(done);
      if (failed) throw new Error(failed);
      return { sessions: objectsOf(done.result.statements[0]?.sets[0]) };
    },

    "endue.database.check-statement": async (/** @type {Record<string, unknown>} */ args) => {
      const conn = named(args.connection, args.database);
      postgres(conn, "A check without running");
      const statement = one(conn, args.sql);
      if (!PREPARED.has(statement.class.verb))
        return {
          checked: false,
          why: `PostgreSQL checks without running only ${[...PREPARED].join(", ")}: this statement is ${statement.class.verb || "unknown"}.`,
        };
      const done = await agents.runs.read(conn, checkSql(statement.text).join(";\n"), {
        args,
        command: "endue.database.check-statement",
        single: true,
        limits: { timeoutSeconds: args.timeoutSeconds },
        names: new Set(),
      });
      const outcome = done.result.statements[0];
      const error = done.result.error ?? outcome?.error;
      if (!error) return { checked: true, ok: true };
      const position = checkPosition(error.position);
      return {
        checked: true,
        ok: false,
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(error.detail ? { detail: error.detail } : {}),
        ...(position !== undefined ? { position } : {}),
      };
    },
  };
}
