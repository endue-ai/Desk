// The overview's server (sections.js): its figures, each naming its statistic and when that was
// reset (connections against the limit, the cache hit ratio, commits, deadlocks, temporary files,
// checkpoints from pg_stat_checkpointer on 17 and later, pg_stat_bgwriter before); transactions
// open for more than a minute; replication as a primary sees it, or a standby's own lag; slots;
// and the settings changed from their defaults by the server's configuration. No DOM.

import { t } from "../../strings/index.js";
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

/** @typedef {[string, string, string, string, string?, string?]} Figure */

const DB = "FROM pg_stat_database WHERE datname = current_database()";
const CLIENTS = "FROM pg_stat_activity WHERE backend_type = 'client backend'";

/** @param {Server} server @returns {Section} */
function figures(server) {
  const v17 = since(server, 17);
  const checkpoints = v17 ? "pg_stat_checkpointer" : "pg_stat_bgwriter";
  const [timed, requested] = v17
    ? ["num_timed", "num_requested"]
    : ["checkpoints_timed", "checkpoints_req"];
  const db = (/** @type {string} */ name, /** @type {string} */ value, unit = "count") =>
    /** @type {Figure} */ ([name, value, unit, "pg_stat_database", "stats_reset", DB]);
  const state = (/** @type {string} */ name, /** @type {string} */ where) =>
    /** @type {Figure} */ ([name, "count(*)", "count", "pg_stat_activity", undefined, where]);
  const checkpoint = (/** @type {string} */ name, /** @type {string} */ column) =>
    /** @type {Figure} */ ([
      name,
      column,
      "count",
      checkpoints,
      "stats_reset",
      `FROM ${checkpoints}`,
    ]);
  /** @type {Figure[]} */
  const list = [
    ["Version", "current_setting('server_version')", "text", "server_version (pg_settings)"],
    ["Running since", "pg_postmaster_start_time()", "time", "pg_postmaster_start_time()"],
    state("Connections in use", CLIENTS),
    [
      "Connection limit",
      "current_setting('max_connections')",
      "count",
      "pg_settings (max_connections)",
    ],
    [
      "Reserved for superusers",
      "current_setting('superuser_reserved_connections')",
      "count",
      "pg_settings (superuser_reserved_connections)",
    ],
    state("Active sessions", `${CLIENTS} AND state = 'active'`),
    state("Idle in a transaction", `${CLIENTS} AND state LIKE 'idle in transaction%'`),
    db(
      "Cache hit ratio",
      "round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 2)",
      "percent",
    ),
    db("Commits", "xact_commit"),
    db("Rollbacks", "xact_rollback"),
    db("Deadlocks", "deadlocks"),
    db("Temporary files written", "temp_bytes", "bytes"),
    checkpoint("Checkpoints on schedule", timed),
    checkpoint("Checkpoints requested", requested),
  ];
  const parts = list.map((args, i) => figure(i + 1, ...args));
  return {
    id: "server",
    title: t("features.overview.server.server"),
    source: `pg_stat_activity, pg_stat_database, ${checkpoints}, pg_settings`,
    counters: "rows",
    columns: [
      { key: "figure", label: t("features.overview.server.figure") },
      { key: "value", label: t("features.overview.server.value") },
      { key: "statistic", label: t("features.overview.server.from") },
      { key: "since", label: t("features.overview.server.countedSince"), format: "time" },
    ],
    empty: t("features.overview.server.noFigureWasRead"),
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
      title: t("features.overview.server.longTransactions"),
      source: "pg_stat_activity (xact_start, backend_xmin)",
      counters: "none",
      columns: [
        { key: "pid", label: t("features.overview.server.pid") },
        { key: "role", label: t("features.overview.server.role") },
        { key: "application", label: t("features.overview.server.application") },
        { key: "state", label: t("features.overview.server.state") },
        { key: "open_seconds", label: t("features.overview.server.openFor"), format: "seconds" },
        { key: "xmin_age", label: t("features.overview.server.holdsBackXminAge"), format: "count" },
        { key: "query", label: t("features.overview.server.lastStatement"), format: "query" },
      ],
      empty: t("features.overview.server.noTransactionHasBeenOpenFor"),
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
      title: t("features.overview.server.replicationSlots"),
      source: "pg_replication_slots",
      counters: "none",
      columns: [
        { key: "slot", label: t("features.overview.server.slot") },
        { key: "type", label: t("features.overview.server.type") },
        { key: "database", label: t("features.overview.server.database") },
        { key: "active", label: t("features.overview.server.active"), format: "bool" },
        { key: "wal_status", label: t("features.overview.server.wal") },
        { key: "retained_bytes", label: t("features.overview.server.retains"), format: "bytes" },
        { key: "safe_wal_bytes", label: t("features.overview.server.untilLost"), format: "bytes" },
      ],
      empty: t("features.overview.server.thisServerHasNoReplicationSlots"),
      sql: lines(
        "SELECT s.slot_name AS slot, s.slot_type AS type, s.database, s.active, s.wal_status,",
        `  pg_wal_lsn_diff(${lsn}, s.restart_lsn)::bigint AS retained_bytes, s.safe_wal_size AS safe_wal_bytes`,
        "FROM pg_replication_slots s",
        `ORDER BY 6 DESC NULLS LAST, 1 LIMIT ${LIMIT}`,
      ),
    },
    {
      id: "settings",
      title: t("features.overview.server.settingsChangedFromTheirDefaults"),
      source: "pg_settings (setting, boot_val, source)",
      counters: "none",
      search: true,
      columns: [
        { key: "name", label: t("features.overview.server.setting") },
        { key: "setting", label: t("features.overview.server.value") },
        { key: "unit", label: t("features.overview.server.unit") },
        { key: "default_value", label: t("features.overview.server.default") },
        { key: "source", label: t("features.overview.server.setBy") },
        {
          key: "pending_restart",
          label: t("features.overview.server.restartPending"),
          format: "bool",
        },
      ],
      empty: t("features.overview.server.everySettingHasItsDefaultValue"),
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
    title: t("features.overview.server.replication"),
    source: "pg_stat_replication",
    counters: "none",
    columns: [
      { key: "standby", label: t("features.overview.server.standby") },
      { key: "address", label: t("features.overview.server.address") },
      { key: "state", label: t("features.overview.server.state") },
      { key: "sync_state", label: t("features.overview.server.sync") },
      { key: "replay_lag_bytes", label: t("features.overview.server.behind"), format: "bytes" },
      {
        key: "write_lag_seconds",
        label: t("features.overview.server.writeLag"),
        format: "seconds",
      },
      {
        key: "flush_lag_seconds",
        label: t("features.overview.server.flushLag"),
        format: "seconds",
      },
      {
        key: "replay_lag_seconds",
        label: t("features.overview.server.replayLag"),
        format: "seconds",
      },
    ],
    empty: t("features.overview.server.noStandbyStreamsFromThisServer"),
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
    title: t("features.overview.server.replicationThisServerIsAStandby"),
    source: "pg_stat_wal_receiver, pg_last_wal_replay_lsn(), pg_last_xact_replay_timestamp()",
    counters: "none",
    columns: [
      { key: "status", label: t("features.overview.server.receiver") },
      { key: "slot", label: t("features.overview.server.slot") },
      {
        key: "replay_lag_bytes",
        label: t("features.overview.server.replayBehind"),
        format: "bytes",
      },
      {
        key: "replay_lag_seconds",
        label: t("features.overview.server.lastReplayed"),
        format: "seconds",
      },
      { key: "last_replayed", label: t("features.overview.server.replayedAt"), format: "time" },
    ],
    empty: t("features.overview.server.nothingWasRead"),
    sql: lines(
      "SELECT coalesce(w.status, 'not streaming') AS status, w.slot_name AS slot,",
      "  pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn())::bigint AS replay_lag_bytes,",
      "  extract(epoch FROM now() - pg_last_xact_replay_timestamp())::bigint AS replay_lag_seconds,",
      "  pg_last_xact_replay_timestamp() AS last_replayed",
      "FROM (SELECT 1) one LEFT JOIN pg_stat_wal_receiver w ON true",
    ),
  });
}
