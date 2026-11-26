// Reading a server's overview through the plugin's execute (every run under its guards, on the
// core's sessions since PG-01c): the probe first, then every section in one run. A run stops at a
// failed statement, so the sections after it are read again in a run of their own and the failed
// one says what it could not read. Each run first sets lock_timeout for its own session, so a size
// that waits behind another session's lock fails its section instead of the overview. No DOM.

import { t } from "../../strings/index.js";
import { PROBE_SQL, serverOf } from "./probe.js";
import { failureOf, sectionsFor } from "./sections.js";
import { recordsReset } from "./statements.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../catalog.js").Execute} Execute
 * @typedef {import("./probe.js").Server} Server
 * @typedef {import("./sql.js").Section} Section
 * @typedef {Section & {
 *   names?: string[], rows?: (string | null)[][], failed?: string, since?: string | null,
 *   unrecorded?: boolean,
 * }} Read
 *   `names` are the columns the server answered with, `rows` their values; `since` is when the
 *   section's counters were last reset (null: never), `unrecorded` when the statistic keeps no
 *   such time.
 * @typedef {{
 *   connection: string, name: string, server: Server | null, sections: Read[], at: number,
 *   reading: boolean, failed?: string,
 * }} OverviewState
 */

export const LOCK_TIMEOUT = "SELECT set_config('lock_timeout', '2s', false)";
const MAX_ROWS = 1000;
/** Failures of the run, not of one statement: the rest would fail the same way. */
const ENDS_RUN = new Set([
  "auth",
  "connect",
  "client",
  "timeout",
  "cancelled",
  "missing",
  "refused",
]);

/**
 * @param {Execute} execute
 * @param {Connection} conn
 * @param {() => number} [now]
 * @returns {Promise<OverviewState>}
 */
export async function readOverview(execute, conn, now = Date.now) {
  const probe = await execute(conn, PROBE_SQL, { catalog: true, maxRows: 10 });
  const first = probe.result.statements[0];
  const error = probe.result.error ?? first?.error;
  const set = first?.sets[0];
  if (error || !set?.rows[0])
    throw new Error(
      t("features.overview.read.couldNotRead", {
        name: String(conn.name),
        value: String(error?.message ?? t("features.overview.read.theServerSaidNothing")),
      }),
    );
  const server = serverOf(set.columns, set.rows[0]);
  const sections = sectionsFor(server);
  const runnable = sections.filter((s) => s.sql && !s.missing);
  const outcomes = await readAll(
    execute,
    conn,
    runnable.map((s) => /** @type {string} */ (s.sql)),
  );
  const reads = sections.map((section) => {
    const at = runnable.indexOf(section);
    return at < 0 ? section : withOutcome(section, outcomes[at], server);
  });
  return {
    connection: conn.id,
    name: conn.name,
    server,
    sections: reads,
    at: now(),
    reading: false,
  };
}

/**
 * @typedef {{ names: string[], rows: (string | null)[][] } | { message: string }} Outcome
 */

/**
 * Every statement's rows or failure, running again after a statement that stopped the run.
 * @param {Execute} execute
 * @param {Connection} conn
 * @param {string[]} sqls
 * @returns {Promise<Outcome[]>}
 */
export async function readAll(execute, conn, sqls) {
  /** @type {Outcome[]} */
  const out = [];
  let from = 0;
  while (from < sqls.length) {
    const run = await execute(conn, [LOCK_TIMEOUT, ...sqls.slice(from)].join(";\n"), {
      catalog: true,
      maxRows: MAX_ROWS,
    });
    const [lock, ...statements] = run.result.statements;
    const whole = run.result.error ?? lock?.error;
    if (whole) {
      for (let i = from; i < sqls.length; i++) out[i] = { message: whole.message };
      break;
    }
    let next = sqls.length;
    for (const [i, s] of statements.entries()) {
      if (!s.ran) {
        next = Math.min(next, from + i);
        continue;
      }
      if (s.error && ENDS_RUN.has(s.error.kind)) {
        for (let k = from + i; k < sqls.length; k++) out[k] = { message: s.error.message };
        return out;
      }
      out[from + i] = s.error
        ? { message: s.error.message }
        : { names: s.sets[0]?.columns ?? [], rows: s.sets[0]?.rows ?? [] };
    }
    if (next <= from) {
      for (let i = from; i < sqls.length; i++)
        out[i] = { message: t("features.overview.read.theServerRanNothing") };
      break;
    }
    from = next;
  }
  return out;
}

/** A section with what its statement gave back. */
function withOutcome(
  /** @type {Section} */ section,
  /** @type {Outcome | undefined} */ outcome,
  /** @type {Server} */ server,
) {
  if (!outcome || "message" in outcome)
    return { ...section, ...failureOf(section, outcome?.message ?? "not run", server.role) };
  /** @type {Read} */
  const read = { ...section, names: outcome.names, rows: outcome.rows };
  if (section.counters === "database") read.since = server.statsReset;
  if (section.counters === "statements") {
    if (recordsReset(server)) {
      const at = outcome.names.indexOf("since");
      read.since = at < 0 ? null : (outcome.rows[0]?.[at] ?? null) || null;
    } else read.unrecorded = true;
  }
  return read;
}
