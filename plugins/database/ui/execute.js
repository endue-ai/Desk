// Running SQL on a connection: cut it into statements, check them (what no client may run here,
// writes on a read-only connection, a dry run that could not roll back), ask the person before what
// is hard to undo, run the engine's client, read what it printed, and when the client says a
// password is missing or wrong, ask for one once and run again. No DOM.

import { failedRun } from "./engines/common.js";
import { engineOf } from "./engines/index.js";
import { nonce as makeNonce } from "./engines/text.js";
import { classify, readsOnly } from "./sql/classify.js";
import { split } from "./sql/split.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./engines/common.js").RunResult} RunResult
 * @typedef {import("./engines/common.js").DbError} DbError
 * @typedef {import("./sql/split.js").Statement} Statement
 * @typedef {import("./sql/classify.js").Class} Class
 * @typedef {import("./settings.js").Settings} Settings
 * @typedef {"run" | "transaction" | "dry-run"} Mode
 * @typedef {{ conn: Connection, sql: string, statements: Statement[], classes: Class[], mode: Mode, result: RunResult, at: number }} Execution
 * @typedef {{ mode?: Mode, maxRows?: number, interactive?: boolean, agent?: boolean, catalog?: boolean, statements?: Statement[] }} ExecuteOptions
 *   `interactive: false` never asks for a password; `agent` asks before any write; `catalog` is the
 *   plugin's own reading and asks nothing.
 * @typedef {{
 *   runner: { run(invocation: import("./engines/common.js").Invocation, options?: { timeoutMs?: number }): Promise<import("./engines/common.js").Outcome> },
 *   clients: { get(engine: import("./engines/common.js").EngineId): Promise<import("./clients.js").Client> },
 *   settings(): Settings,
 *   confirm(title: string, reasons: string[]): Promise<boolean>,
 *   passwords: { get(id: string): string | undefined, set(id: string, value: string): void, ask(conn: Connection, why: string): Promise<string | undefined> },
 *   cancelled(message: string): Error,
 *   now?(): number,
 *   random?(): number,
 * }} Deps
 */

/** A run refused before it started; its message is the sentence to show. */
export class Refusal extends Error {
  constructor(/** @type {string} */ message) {
    super(message);
    this.name = "Refusal";
  }
}

/** @param {Deps} deps */
export function createExecutor(deps) {
  const now = deps.now ?? (() => Date.now());

  /**
   * @param {Connection} conn
   * @param {string} sql
   * @param {ExecuteOptions} [options]
   * @returns {Promise<Execution>}
   */
  const execute = async (conn, sql, options = {}) => {
    const engine = engineOf(conn.engine);
    const mode = options.mode ?? "run";
    const statements = options.statements ?? split(sql, engine.dialect);
    if (statements.length === 0)
      throw new Refusal("Nothing to run: the editor holds no statement.");
    const classes = statements.map((statement) => classify(statement, engine.dialect));
    check(conn, engine.ddlCommits, classes, mode);
    if (!options.catalog) await confirm(conn, statements, classes, mode, options.agent === true);
    const settings = deps.settings();
    const maxRows = options.maxRows ?? settings.maxRows;
    const timeoutMs = settings.timeoutSeconds * 1000;
    const single = statements.length === 1 && (classes[0]?.rows ?? false) && mode === "run";
    const at = now();

    const attempt = async (/** @type {string | undefined} */ password) => {
      try {
        const client = await deps.clients.get(conn.engine);
        const invocation = engine.plan(conn, {
          statements,
          maxRows,
          timeoutMs,
          ...(password !== undefined ? { password } : {}),
          mode,
          flavor: client.flavor === "mariadb" ? "mariadb" : "mysql",
          nonce: makeNonce(deps.random),
          single,
        });
        invocation.command = client.command;
        // PostgreSQL ends a statement on the server (statement_timeout); the client's own limit is
        // the backstop. The other two have only the client's.
        const limit = timeoutMs > 0 ? timeoutMs + (engine.id === "postgresql" ? 5000 : 0) : 0;
        const outcome = await deps.runner.run(invocation, { timeoutMs: limit });
        const result = engine.parse(outcome, invocation, timeoutMs);
        if (outcome.cancelled && !result.statements.some((s) => s.error?.kind === "cancelled"))
          result.notices.push(
            "Cancelled: the statements shown had finished before the cancel reached them.",
          );
        return result;
      } catch (error) {
        const kind =
          /** @type {{ kind?: string }} */ (error)?.kind === "missing" ? "missing" : "client";
        const message = error instanceof Error ? error.message : String(error);
        return failedRun(statements, { kind, message });
      }
    };

    let result = await attempt(deps.passwords.get(conn.id));
    const auth = authError(result);
    if (auth && options.interactive !== false) {
      const typed = await deps.passwords.ask(conn, auth.message);
      if (typed !== undefined) {
        result = await attempt(typed);
        if (!authError(result)) deps.passwords.set(conn.id, typed);
      }
    }
    return { conn, sql, statements, classes, mode, result, at };
  };

  /**
   * Ask before writes on a production connection, before dangerous statements anywhere (both under
   * the `confirm` setting), and before any write an agent asks for (always).
   * @param {Connection} conn
   * @param {Statement[]} statements
   * @param {Class[]} classes
   * @param {Mode} mode
   * @param {boolean} agent
   */
  const confirm = async (conn, statements, classes, mode, agent) => {
    if (mode === "dry-run") return;
    const writes = classes.some((c) => c.kind === "write" || c.kind === "ddl" || c.opensWrite);
    const dangerous = classes.flatMap((c, i) =>
      c.dangerous ? [`Statement ${i + 1}: ${c.dangerous}`] : [],
    );
    const production = conn.tag === "production" && writes;
    const asked = deps.settings().confirm && (production || dangerous.length > 0);
    if (!asked && !(agent && writes)) return;
    const reasons = [
      ...(agent && writes ? ["An agent asks to change data."] : []),
      ...(production ? [`${conn.name} is tagged production.`] : []),
      ...dangerous,
      ...statements.slice(0, 3).map((s) => oneLine(s.text)),
      ...(statements.length > 3 ? [`and ${statements.length - 3} more statements`] : []),
    ];
    const count = statements.length === 1 ? "this statement" : `${statements.length} statements`;
    if (!(await deps.confirm(`Run ${count} on ${conn.name}?`, reasons)))
      throw deps.cancelled("Not run.");
  };

  return { execute };
}

/**
 * What no run may do: a statement a client must not see, a write on a read-only connection, a dry
 * run holding its own transaction (or DDL that commits at once), a transaction run holding its own.
 * @param {Connection} conn
 * @param {boolean} ddlCommits
 * @param {Class[]} classes
 * @param {Mode} mode
 */
export function check(conn, ddlCommits, classes, mode) {
  const at = (/** @type {(c: Class) => unknown} */ test) => classes.findIndex(test);
  const refused = at((c) => c.refused !== "");
  if (refused >= 0) throw new Refusal(`Statement ${refused + 1}: ${classes[refused]?.refused}`);
  if (conn.readOnly && !readsOnly(classes)) {
    const index = at((c) => c.kind === "write" || c.kind === "ddl" || c.opensWrite);
    const verb = classes[index]?.verb ?? "it";
    throw new Refusal(`${conn.name} is read-only: statement ${index + 1} (${verb}) may change it.`);
  }
  const own = at((c) => c.kind === "transaction");
  if (mode !== "run" && own >= 0) {
    throw new Refusal(
      mode === "dry-run"
        ? "A dry run rolls back at the end, so it cannot hold BEGIN, COMMIT or ROLLBACK."
        : "Run in a transaction holds its own BEGIN and COMMIT: take them out of the script.",
    );
  }
  if (mode === "dry-run" && ddlCommits && at((c) => c.kind === "ddl") >= 0)
    throw new Refusal("MySQL commits DDL at once, so a dry run cannot hold CREATE, ALTER or DROP.");
}

/** The authentication failure a run ended with, if any. */
export function authError(/** @type {RunResult} */ result) {
  if (result.error?.kind === "auth") return result.error;
  return result.statements.find((s) => s.error?.kind === "auth")?.error;
}

/** A statement on one line, cut at 120 characters. */
export function oneLine(/** @type {string} */ text) {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}
