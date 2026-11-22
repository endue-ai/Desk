// How an agent's SQL runs (PG-91, ADR 0346). A read runs on a connection opened read-only (on
// PostgreSQL a short session with default_transaction_read_only, SQLite's -readonly, MySQL's
// read-only session transaction), with a row limit and a timeout the agent may lower but never raise
// past the settings, and its results masked (mask.js). A write is always asked, with the statement,
// the connection and its tag, for this run only, and then meets the executor's guards (read-only,
// what no client may run). What ran is noted on the call for the audit list. No DOM.

import { engineOf } from "../../engines/index.js";
import { check, oneLine } from "../../execute.js";
import { formatCount } from "../../format.js";
import { classify, readsOnly } from "../../sql/classify.js";
import { split } from "../../sql/split.js";
import { leakOf, maskSet, namesOf } from "./mask.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../execute.js").Execution} Execution
 * @typedef {{ maxRows?: unknown, timeoutSeconds?: unknown }} Limits
 * @typedef {{
 *   execute: import("../../catalog.js").Execute,
 *   settings(): import("../../settings.js").Settings,
 *   confirm(title: string, reasons: string[]): Promise<boolean>,
 *   cancelled(message: string): Error,
 *   access: ReturnType<typeof import("./access.js").createAccess>,
 *   gate: ReturnType<typeof import("./gate.js").createGate>,
 * }} Deps
 */

export const ROWS_DEFAULT = 100;
export const ROWS_MAX = 1000;

/** The row limit and timeout an agent gets: its own when lower, the settings' at most. */
export function limitsOf(
  /** @type {import("../../settings.js").Settings} */ settings,
  /** @type {Limits} */ asked,
  rows = ROWS_DEFAULT,
) {
  const want = (/** @type {unknown} */ n) =>
    typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
  const maxRows = Math.min(ROWS_MAX, settings.maxRows, want(asked.maxRows) ?? rows);
  const own = want(asked.timeoutSeconds);
  const cap = settings.timeoutSeconds;
  const seconds = cap > 0 ? Math.min(cap, own ?? cap) : (own ?? 0);
  return { maxRows, timeoutMs: seconds * 1000 };
}

/** The same connection, opened read-only. */
export const readOnly = (/** @type {Connection} */ conn) => ({ ...conn, readOnly: true });

/** Several statements' notes as one: their texts, their rows, the first failure. */
function merged(/** @type {import("./gate.js").Note[]} */ notes) {
  const first = /** @type {import("./gate.js").Note} */ (notes[0]);
  const failed = notes.find((n) => n.outcome !== "ran");
  const counted = notes.filter((n) => n.rows !== null);
  return {
    ...first,
    statement: notes.map((n) => n.statement).join(";\n"),
    rows: counted.length ? counted.reduce((n, x) => n + (x.rows ?? 0), 0) : null,
    outcome: failed?.outcome ?? "ran",
    ...(failed?.error ? { error: failed.error } : {}),
  };
}

/** @param {Deps} deps */
export function createAgentRuns(deps) {
  /** Run with the timeout as a cancel, so no statement outlives it. */
  const timed = async (
    /** @type {Connection} */ conn,
    /** @type {string} */ sql,
    /** @type {import("../../execute.js").ExecuteOptions} */ options,
    /** @type {number} */ timeoutMs,
  ) => {
    const stop = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => stop.abort(), timeoutMs) : undefined;
    try {
      return await deps.execute(conn, sql, { ...options, signal: stop.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  /** Ask the person about an agent's write: for this run only. */
  const ask = async (
    /** @type {Connection} */ conn,
    /** @type {import("../../sql/split.js").Statement[]} */ statements,
    /** @type {import("../../sql/classify.js").Class[]} */ classes,
    /** @type {string} */ caller,
  ) => {
    const dangerous = classes.flatMap((c, i) =>
      c.dangerous ? [`Statement ${i + 1}: ${c.dangerous}`] : [],
    );
    const reasons = [
      "An agent asks to change data.",
      ...(caller !== "desk" ? [`Asked by ${caller}.`] : []),
      conn.tag === "none" ? `${conn.name} has no tag.` : `${conn.name} is tagged ${conn.tag}.`,
      "For this run only: the next change asks again.",
      ...dangerous,
      ...statements.slice(0, 3).map((s) => oneLine(s.text)),
      ...(statements.length > 3
        ? [`and ${formatCount(statements.length - 3)} more statements`]
        : []),
    ];
    const count =
      statements.length === 1 ? "this statement" : `${formatCount(statements.length)} statements`;
    return deps.confirm(`Run ${count} on ${conn.name}?`, reasons);
  };

  /** Note each statement of a run on the call, and mask what it read. */
  const finish = (
    /** @type {Execution} */ done,
    /** @type {{ args: object, command: string, asked: boolean, allowed: boolean | null, single?: boolean }} */ how,
    /** @type {Set<string>} */ names,
  ) => {
    const dialect = engineOf(done.conn.engine).dialect;
    const { result } = done;
    /** @type {import("./gate.js").Note[]} */
    const notes = [];
    const statements = result.statements.map((outcome, i) => {
      const text = done.statements[i]?.text ?? "";
      const leak = outcome.sets.length ? leakOf(text, dialect, outcome.sets, names) : "";
      const sets = leak ? [] : outcome.sets.map((set) => maskSet(set, names));
      const rows = outcome.ran
        ? (outcome.affected ?? sets.reduce((n, set) => n + set.rows.length, 0))
        : null;
      const error = leak
        ? `Not answered: it uses the sensitive column ${leak} other than by selecting it by name.`
        : (outcome.error?.message ?? (result.error && !outcome.ran ? result.error.message : ""));
      notes.push({
        connection: done.conn.id,
        statement: text,
        rows,
        asked: how.asked,
        allowed: how.allowed,
        outcome: leak ? "refused" : !outcome.ran || outcome.error ? "failed" : "ran",
        ...(error ? { error } : {}),
      });
      return { ...outcome, sets, ...(leak ? { error: { kind: "refused", message: error } } : {}) };
    });
    // A tool's statements of its own make one entry: the call, as the agent made it.
    const kept = how.single && notes.length > 1 ? [merged(notes)] : notes;
    for (const note of kept) deps.gate.note(how.args, how.command, note);
    return /** @type {Execution} */ ({ ...done, result: { ...result, statements } });
  };

  /**
   * An agent's SQL: a read as it is, a write once the person allows it.
   * @param {Connection} conn
   * @param {string} sql
   * @param {{ args: object, command: string, limits?: Limits, rows?: number }} how
   */
  const run = async (conn, sql, how) => {
    const engine = engineOf(conn.engine);
    const statements = split(sql, engine.dialect);
    if (statements.length === 0) throw new Error("Nothing to run: the SQL holds no statement.");
    const classes = statements.map((s) => classify(s, engine.dialect));
    const { maxRows, timeoutMs } = limitsOf(deps.settings(), how.limits ?? {}, how.rows);
    const names = namesOf((await deps.access.of(conn.id)).sensitive);
    const call = deps.gate.callOf(how.command, how.args);
    const base = { agent: true, interactive: false, maxRows, statements };
    if (readsOnly(classes)) {
      const done = await timed(readOnly(conn), sql, base, timeoutMs);
      return finish(done, { ...how, asked: false, allowed: null }, names);
    }
    check(conn, engine.ddlCommits, classes, "run");
    const allowed = await ask(conn, statements, classes, call.caller);
    if (!allowed) {
      deps.gate.note(how.args, how.command, {
        connection: conn.id,
        statement: sql,
        rows: null,
        asked: true,
        allowed: false,
      });
      throw deps.cancelled("Not run.");
    }
    const done = await timed(conn, sql, { ...base, asked: true }, timeoutMs);
    return finish(done, { ...how, asked: true, allowed: true }, names);
  };

  /** A read the plugin writes for an agent's tool: never a write, masked by the table's names. */
  const read = async (
    /** @type {Connection} */ conn,
    /** @type {string} */ sql,
    /** @type {{ args: object, command: string, limits?: Limits, rows?: number, names?: Set<string>, single?: boolean, mode?: "describe", statements?: import("../../editor/bind.js").Bound[] }} */ how,
  ) => {
    const { maxRows, timeoutMs } = limitsOf(deps.settings(), how.limits ?? {}, how.rows);
    const names = how.names ?? namesOf((await deps.access.of(conn.id)).sensitive);
    // A check (`mode: "describe"`) runs nothing: the server says what the statement takes and answers.
    const check = how.mode ? { mode: how.mode, statements: how.statements ?? [] } : {};
    const done = await timed(
      readOnly(conn),
      sql,
      { agent: true, interactive: false, maxRows, ...check },
      timeoutMs,
    );
    return finish(done, { ...how, asked: false, allowed: null }, names);
  };

  return { run, read };
}
