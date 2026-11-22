// The bodies the schema cache does not keep (ADR 0285), read with the server's own source reads
// that PG-56 opens a routine's or a view's source with: pg_get_functiondef for a schema's routines,
// in batches by oid, and pg_get_viewdef for its views and materialized views, in one statement. Each
// is a catalog run of deps.execute (nothing to ask, never a password prompt mid-search) that the
// search's signal stops. Kept beside the cached schema they belong to, so a schema is read once
// per read of it in the cache. Pure but for the reader.

import { quoteText } from "../../sql/quote.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./items.js").Need} Need
 */

/** Routines per statement. */
export const BATCH = 200;

/** The definitions of these routines: oid, pg_get_functiondef. */
export function routinesSql(/** @type {string[]} */ oids) {
  const list = oids.filter((oid) => /^\d+$/u.test(oid)).join(", ");
  return (
    "SELECT p.oid::text, pg_catalog.pg_get_functiondef(p.oid) FROM pg_catalog.pg_proc p " +
    `WHERE p.oid IN (${list}) ORDER BY 1`
  );
}

/** The definitions of a schema's views and materialized views: name, pg_get_viewdef. */
export function viewsSql(/** @type {string} */ schema) {
  return (
    "SELECT c.relname, pg_catalog.pg_get_viewdef(c.oid, true) FROM pg_catalog.pg_class c " +
    "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = " +
    `${quoteText("postgresql", schema)} AND c.relkind IN ('v', 'm') ORDER BY 1`
  );
}

/** The bodies read, by the object they belong to (a schema's lookups, which a new read replaces). */
const kept = /** @type {WeakMap<object, Map<string, string>>} */ (new WeakMap());

/** The bodies held for a schema read, made on first use. */
export function heldFor(/** @type {object} */ schemaRead) {
  let found = kept.get(schemaRead);
  if (!found) {
    found = new Map();
    kept.set(schemaRead, found);
  }
  return found;
}

/** What is still to read of a need. */
export function missing(/** @type {Need} */ need, /** @type {Map<string, string>} */ held) {
  return {
    routines: need.routines.filter((oid) => !held.has(`r:${oid}`)),
    views: need.views.filter((name) => !held.has(`v:${name}`)),
  };
}

/** A failed or cancelled run, as an Error with its kind as `code`. */
const failure = (/** @type {import("../../execute.js").Execution} */ run) => {
  const error = run.result.error ?? run.result.statements.find((s) => s.error)?.error;
  if (!error) return undefined;
  return Object.assign(
    new Error(error.detail ? `${error.message} ${error.detail}` : error.message),
    {
      code: error.kind === "cancelled" ? "cancelled" : error.kind,
    },
  );
};

/**
 * Read what is missing into `held`: `r:<oid>` and `v:<name>`, an absent definition as "".
 * @param {import("../../catalog.js").Execute} execute
 * @param {Connection} conn
 * @param {string} schema
 * @param {Need} need
 * @param {Map<string, string>} held
 * @param {AbortSignal} signal
 */
export async function readBodies(execute, conn, schema, need, held, signal) {
  const todo = missing(need, held);
  const runs = [];
  for (let i = 0; i < todo.routines.length; i += BATCH)
    runs.push({ sql: routinesSql(todo.routines.slice(i, i + BATCH)), key: "r" });
  if (todo.views.length) runs.push({ sql: viewsSql(schema), key: "v" });
  for (const { sql, key } of runs) {
    const run = await execute(conn, sql, {
      catalog: true,
      interactive: false,
      maxRows: BATCH * 5,
      signal,
    });
    const failed = failure(run);
    if (failed) throw failed;
    for (const [name, def] of run.result.statements[0]?.sets[0]?.rows ?? [])
      if (name) held.set(`${key}:${name}`, def ?? "");
  }
  for (const oid of todo.routines) if (!held.has(`r:${oid}`)) held.set(`r:${oid}`, "");
  for (const name of todo.views) if (!held.has(`v:${name}`)) held.set(`v:${name}`, "");
}
