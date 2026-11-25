// The server's activity in SQL, PostgreSQL 13 and later: the server's version and the session that
// reads (the head), the sessions with who blocks each (pg_stat_activity, pg_blocking_pids), the
// locks (pg_locks), and the two signals. What differs by version: a lock's wait start
// (pg_locks.waitstart, 14) and pg_terminate_backend waiting for the end (14). Every age is in
// milliseconds, counted on the server at the read. No DOM.

/** The oldest server the view reads (server_version_num): 13, which has leader_pid. */
export const FLOOR = 130000;
/** From this one on, a lock says when its wait began and an end can be waited for. */
const FOURTEEN = 140000;
/** The plugin's own sessions' application_name (engines/pg-session.js's APPLICATION). */
export const OWN_APPLICATION = "endue";
/** At most this many rows of each read; the waiting locks come first. */
export const LOCK_ROWS = 5000;
/** How long an end waits for the session to be gone (14 and later). */
export const END_WAIT_MS = 5000;

/** Milliseconds from a timestamp column to the read. */
const age = (/** @type {string} */ column) =>
  `(extract(epoch FROM now() - ${column}) * 1000)::bigint`;

/** The version (number and text), the reading session's process id and its database. */
export const HEAD =
  "SELECT current_setting('server_version_num')::int, current_setting('server_version'), " +
  "pg_catalog.pg_backend_pid(), current_database()";

/** Every session the role may see, with the process ids blocking each. */
export function sessionsSql() {
  return [
    "SELECT a.pid, a.leader_pid, a.usename, a.datname, a.application_name,",
    "host(a.client_addr), a.client_port, a.backend_type, a.state, a.wait_event_type, a.wait_event,",
    `${age("a.state_change")}, ${age("a.xact_start")}, ${age("a.query_start")},`,
    "array_to_string(pg_catalog.pg_blocking_pids(a.pid), ' '), a.query",
    "FROM pg_catalog.pg_stat_activity a ORDER BY a.pid",
  ].join(" ");
}

/**
 * Every lock held or waited for, the waiting ones first; a relation of another database is named
 * by its oid, as this session cannot read that database's catalog.
 * @param {number} version server_version_num
 */
export function locksSql(version) {
  const wait = version >= FOURTEEN ? age("l.waitstart") : "NULL::bigint";
  return [
    "SELECT l.pid, l.locktype, l.mode, l.granted, d.datname,",
    "CASE WHEN l.relation IS NULL THEN NULL WHEN d.datname = current_database()",
    "THEN l.relation::regclass::text ELSE l.relation::text END,",
    `l.page, l.tuple, l.virtualxid, l.transactionid::text, l.objid::text, ${wait}`,
    "FROM pg_catalog.pg_locks l LEFT JOIN pg_catalog.pg_database d ON d.oid = l.database",
    "WHERE l.pid IS NOT NULL ORDER BY l.granted, l.pid",
  ].join(" ");
}

/**
 * Cancel a session's statement, or end the session (from 14 on waiting up to END_WAIT_MS for it).
 * @param {"cancel" | "end"} how
 * @param {number} pid
 * @param {number} version server_version_num
 */
export function signalSql(how, pid, version) {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error("A session is named by its process id, a whole number.");
  if (how === "cancel") return `SELECT pg_catalog.pg_cancel_backend(${pid})`;
  return version >= FOURTEEN
    ? `SELECT pg_catalog.pg_terminate_backend(${pid}, ${END_WAIT_MS})`
    : `SELECT pg_catalog.pg_terminate_backend(${pid})`;
}

/**
 * The sentence for a server older than the view reads, or "".
 * @param {string} name the connection's
 * @param {number} version server_version_num
 * @param {string} server server_version
 */
export function tooOld(name, version, server) {
  return version >= FLOOR
    ? ""
    : `${name} runs PostgreSQL ${server}: the activity view reads PostgreSQL 13 and later.`;
}
