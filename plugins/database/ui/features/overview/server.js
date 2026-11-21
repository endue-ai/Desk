// The overview's server (sections.js): its figures, each naming its statistic and when that was
// reset (connections against the limit, the cache hit ratio, commits, deadlocks, temporary files,
// checkpoints from pg_stat_checkpointer on 17 and later, pg_stat_bgwriter before); transactions
// open for more than a minute; replication as a primary sees it, or a standby's own lag; slots;
// and the settings changed from their defaults by the server's configuration. No DOM.

import { LIMIT, lines, since } from "./sql.js";

/**
 * @typedef {import("./sql.js").Section} Section
 * @typedef {import("./probe.js").Server} Server
 */

/** A figure: its name, its value as text, its unit, its statistic and that one's reset time. */
const figure = (
  /** @type {number} */ n,
  /** @type {string} */ name,
  /** @type {string} */ value,
  /** @type {string} */ unit,
  /** @type {string} */ statistic,
  /** @type {string} */ reset = "NULL::timestamptz",
  /** @type {string} */ from = "",
) =>
  `SELECT ${n} AS n, '${name}' AS figure, (${value})::text AS value, '${unit}' AS unit, '${statistic}' AS statistic, ${reset} AS since${from ? ` ${from}` : ""}`;

const DB = "FROM pg_stat_database WHERE datname = current_database()";
const CLIENTS = "FROM pg_stat_activity WHERE backend_type = 'client backend'";

/** @param {Server} server @returns {Section} */
function figures(server) {
  const v17 = since(server, 17);
  const checkpoints = v17 ? "pg_stat_checkpointer" : "pg_stat_bgwriter";
  const [timed, requested] = v17
    ? ["num_timed", "num_requested"]
    : ["checkpoints_timed", "checkpoints_req"];
  const db = (
    /** @type {number} */ n,
    /** @type {string} */ name,
    /** @type {string} */ value,
    unit = "count",
  ) => figure(n, name, value, unit, "pg_stat_database", "stats_reset", DB);
  const parts = [
    figure(1, "Version", "version()", "text", "version()"),
    figure(2, "Connections in use", "count(*)", "count", "pg_stat_activity", undefined, CLIENTS),
    figure(
      3,
      "Connection limit",
      "current_setting('max_connections')",
      "count",
      "pg_settings (max_connections)",
    ),
    figure(
      4,
      "Reserved for superusers",
      "current_setting('superuser_reserved_connections')",
      "count",
      "pg_settings (superuser_reserved_connections)",
    ),
    figure(
      5,
      "Active sessions",
      "count(*)",
      "count",
      "pg_stat_activity",
      undefined,
      `${CLIENTS} AND state = 'active'`,
    ),
    figure(
      6,
      "Idle in a transaction",
      "count(*)",
      "count",
      "pg_stat_activity",
      undefined,
      `${CLIENTS} AND state LIKE 'idle in transaction%'`,
    ),
    db(
      7,
      "Cache hit ratio",
      "round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 2)",
      "percent",
    ),
    db(8, "Commits", "xact_commit"),
    db(9, "Rollbacks", "xact_rollback"),
    db(10, "Deadlocks", "deadlocks"),
    db(11, "Temporary files written", "temp_bytes", "bytes"),
    figure(
      12,
      "Checkpoints on schedule",
      timed,
      "count",
      checkpoints,
      "stats_reset",
      `FROM ${checkpoints}`,
    ),
    figure(
      13,
      "Checkpoints requested",
      requested,
      "count",
      checkpoints,
      "stats_reset",
      `FROM ${checkpoints}`,
    ),
  ];
  return {
    id: "server",
    title: "Server",
    source: `pg_stat_activity, pg_stat_database, ${checkpoints}, pg_settings`,
    counters: "rows",
    columns: [
      { key: "figure", label: "Figure" },
      { key: "value", label: "Value" },
      { key: "statistic", label: "From" },
      { key: "since", label: "Counted since", format: "time" },
    ],
    empty: "No figure was read.",
    sql: lines(
      "SELECT figure, value, unit, statistic, since FROM (",
      parts.join("\n  UNION ALL "),
      ") f ORDER BY n",
    ),
  };
}

/** @param {Server} server @returns {Section[]} */
export function serverSections(server) {
  const lsn = server.standby ? "pg_last_wal_replay_lsn()" : "pg_current_wal_lsn()";
  return [
    figures(server),
    {
      id: "long",
      title: "Long transactions",
      source: "pg_stat_activity (xact_start, backend_xmin)",
      counters: "none",
      columns: [
        { key: "pid", label: "PID" },
        { key: "role", label: "Role" },
        { key: "application", label: "Application" },
        { key: "state", label: "State" },
        { key: "open_seconds", label: "Open for", format: "seconds" },
        { key: "xmin_age", label: "Holds back (xmin age)", format: "count" },
        { key: "query", label: "Last statement", format: "query" },
      ],
      empty: "No transaction has been open for more than a minute.",
      sql: lines(
        "SELECT a.pid, a.usename AS role, a.application_name AS application, a.state,",
        "  extract(epoch FROM now() - a.xact_start)::bigint AS open_seconds,",
        "  age(a.backend_xmin) AS xmin_age, left(a.query, 500) AS query",
        "FROM pg_stat_activity a",
        "WHERE a.xact_start < now() - interval '1 minute' AND a.pid <> pg_backend_pid()",
        `ORDER BY a.xact_start LIMIT ${LIMIT}`,
      ),
    },
    server.standby ? standby() : primary(),
    {
      id: "slots",
      title: "Replication slots",
      source: "pg_replication_slots",
      counters: "none",
      columns: [
        { key: "slot", label: "Slot" },
        { key: "type", label: "Type" },
        { key: "database", label: "Database" },
        { key: "active", label: "Active", format: "bool" },
        { key: "wal_status", label: "WAL" },
        { key: "retained_bytes", label: "Retains", format: "bytes" },
        { key: "safe_wal_bytes", label: "Until lost", format: "bytes" },
      ],
      empty: "This server has no replication slots.",
      sql: lines(
        "SELECT s.slot_name AS slot, s.slot_type AS type, s.database, s.active, s.wal_status,",
        `  pg_wal_lsn_diff(${lsn}, s.restart_lsn)::bigint AS retained_bytes, s.safe_wal_size AS safe_wal_bytes`,
        "FROM pg_replication_slots s",
        `ORDER BY 6 DESC NULLS LAST, 1 LIMIT ${LIMIT}`,
      ),
    },
    {
      id: "settings",
      title: "Settings changed from their defaults",
      source: "pg_settings (setting, boot_val, source)",
      counters: "none",
      search: true,
      columns: [
        { key: "name", label: "Setting" },
        { key: "setting", label: "Value" },
        { key: "unit", label: "Unit" },
        { key: "default_value", label: "Default" },
        { key: "source", label: "Set by" },
        { key: "pending_restart", label: "Restart pending", format: "bool" },
      ],
      empty: "Every setting has its default value.",
      sql: lines(
        "SELECT s.name, s.setting, s.unit, s.boot_val AS default_value, s.source, s.pending_restart",
        "FROM pg_settings s",
        "WHERE s.source IN ('configuration file', 'command line', 'environment variable', 'global',",
        "    'database', 'user', 'database user')",
        "  AND s.setting IS DISTINCT FROM s.boot_val",
        "ORDER BY 1",
      ),
    },
  ];
}

/** A primary: each standby streaming from it and how far behind it is. */
function primary() {
  return /** @type {Section} */ ({
    id: "replication",
    title: "Replication",
    source: "pg_stat_replication",
    counters: "none",
    columns: [
      { key: "standby", label: "Standby" },
      { key: "address", label: "Address" },
      { key: "state", label: "State" },
      { key: "sync_state", label: "Sync" },
      { key: "replay_lag_bytes", label: "Behind", format: "bytes" },
      { key: "write_lag_seconds", label: "Write lag", format: "seconds" },
      { key: "flush_lag_seconds", label: "Flush lag", format: "seconds" },
      { key: "replay_lag_seconds", label: "Replay lag", format: "seconds" },
    ],
    empty: "No standby streams from this server.",
    sql: lines(
      "SELECT r.application_name AS standby, r.client_addr::text AS address, r.state, r.sync_state,",
      "  pg_wal_lsn_diff(pg_current_wal_lsn(), r.replay_lsn)::bigint AS replay_lag_bytes,",
      "  extract(epoch FROM r.write_lag) AS write_lag_seconds,",
      "  extract(epoch FROM r.flush_lag) AS flush_lag_seconds,",
      "  extract(epoch FROM r.replay_lag) AS replay_lag_seconds",
      "FROM pg_stat_replication r",
      `ORDER BY 1, r.pid LIMIT ${LIMIT}`,
    ),
  });
}

/** A standby: its receiver and how far its replay is behind what it received. */
function standby() {
  return /** @type {Section} */ ({
    id: "replication",
    title: "Replication (this server is a standby)",
    source: "pg_stat_wal_receiver, pg_last_wal_replay_lsn(), pg_last_xact_replay_timestamp()",
    counters: "none",
    columns: [
      { key: "status", label: "Receiver" },
      { key: "slot", label: "Slot" },
      { key: "replay_lag_bytes", label: "Replay behind", format: "bytes" },
      { key: "replay_lag_seconds", label: "Last replayed", format: "seconds" },
      { key: "last_replayed", label: "Replayed at", format: "time" },
    ],
    empty: "Nothing was read.",
    sql: lines(
      "SELECT coalesce(w.status, 'not streaming') AS status, w.slot_name AS slot,",
      "  pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn())::bigint AS replay_lag_bytes,",
      "  extract(epoch FROM now() - pg_last_xact_replay_timestamp())::bigint AS replay_lag_seconds,",
      "  pg_last_xact_replay_timestamp() AS last_replayed",
      "FROM (SELECT 1) one LEFT JOIN pg_stat_wal_receiver w ON true",
    ),
  });
}
