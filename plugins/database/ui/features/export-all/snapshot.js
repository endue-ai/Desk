// The one transaction a whole export reads in (PG-64): a session the export keeps (an owner of its
// own, so a console's session and transaction are never touched), `START TRANSACTION ISOLATION
// LEVEL REPEATABLE READ, READ ONLY` first, so every COPY of it, one table or a folder's many, sees
// the same snapshot and none can write; `ROLLBACK` at the end, however it ended. Each item's columns
// and their types come from the query with no rows, in the same snapshot. No DOM.

import { quoteText } from "../../sql/quote.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../execute.js").ExecuteOptions} ExecuteOptions
 * @typedef {import("../../execute.js").Execution} Execution
 * @typedef {import("../../export/stream.js").Meta} Meta
 */

export const BEGIN = "START TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY";
let owners = 0;

/** The sentence of a run's failure, or "" when it ran. */
export function failureOf(/** @type {Execution} */ run) {
  const error = run.result.error ?? run.result.statements.find((s) => s.error)?.error;
  return error ? error.message : "";
}

/**
 * Begin the export's transaction on a session of its own.
 * @param {Pick<Deps, "execute">} deps
 * @param {Connection} conn
 * @param {AbortSignal} signal
 */
export async function openSnapshot(deps, conn, signal) {
  const session = { owner: `export-all:${++owners}`, kind: /** @type {const} */ ("table") };
  /** One run on the export's session. @param {string} sql @param {ExecuteOptions} [options] */
  const run = (sql, options = {}) =>
    deps.execute(conn, sql, { catalog: true, interactive: false, session, signal, ...options });
  /** A read's first set, or a throw with the server's sentence. */
  const rows = async (/** @type {string} */ sql) => {
    const done = await run(sql);
    const why = failureOf(done);
    if (why) throw new Error(why);
    return done.result.statements.at(-1)?.sets[0] ?? { columns: [], rows: [], truncated: false };
  };
  const begun = await run(`${BEGIN};\nSELECT current_setting('server_version_num')::int4`);
  const why = failureOf(begun);
  if (why) throw new Error(signal.aborted ? "Cancelled." : why);
  const version = Number(begun.result.statements[1]?.sets[0]?.rows[0]?.[0] ?? 0);
  return {
    session,
    version,
    run,
    /** The columns of `query` and their types' OIDs and names, from its query with no rows. */
    async describe(/** @type {string} */ query) {
      const set = await rows(`SELECT * FROM (\n${query}\n) AS endue_export LIMIT 0`);
      const oids = set.columns.map((_, i) => set.types?.[i] ?? 25);
      const known = [...new Set(oids)];
      const named = await rows(
        `SELECT oid::int4, format_type(oid, NULL) FROM pg_type WHERE oid = ANY ('{${known.join(",")}}'::oid[])`,
      );
      const names = new Map(named.rows.map((r) => [Number(r[0]), r[1] ?? ""]));
      return /** @type {Meta} */ ({
        columns: set.columns,
        oids,
        types: oids.map((oid) => names.get(oid) ?? ""),
      });
    },
    /** The tables, partitioned tables, views, materialized views and foreign tables of a schema, by name. */
    async tables(/** @type {string} */ schema) {
      const set = await rows(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${quoteText("postgresql", schema)} AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND NOT c.relispartition ORDER BY 1`,
      );
      return set.rows.map((r) => r[0] ?? "");
    },
    /** End the transaction, whatever came of the export. */
    close: () =>
      deps
        .execute(conn, "ROLLBACK", { catalog: true, interactive: false, session })
        .catch(() => undefined),
  };
}
