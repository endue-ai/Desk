// The overview's first read (read.js): which server this is (its version, whether it is a standby,
// since when it runs), what the connection's role may see (pg_read_all_stats, pg_read_all_settings:
// pg_monitor holds both), whether pg_stat_statements is there, loaded or only available, and the
// settings the sections' sentences name. Everything it calls is open to every role. No DOM.

import { t } from "../../strings/index.js";
import { lines } from "./sql.js";

/**
 * @typedef {{
 *   versionNum: number, version: string, started: string | null, upSeconds: number | null,
 *   standby: boolean, database: string, role: string, allStats: boolean, allSettings: boolean,
 *   statsReset: string | null, maxConnections: number,
 *   pgss: { version: string | null, schema: string | null, available: string | null, preload: string | null },
 *   autovacuum: {
 *     on: boolean, vacuumThreshold: string, vacuumScale: string, analyzeThreshold: string,
 *     analyzeScale: string, freezeMaxAge: string,
 *   },
 * }} Server
 *   `pgss.preload` is shared_preload_libraries, null when the role may not read it.
 */

const PGSS = "'pg_stat_statements'";

export const PROBE_SQL = lines(
  "SELECT current_setting('server_version_num')::int AS version_num,",
  "  current_setting('server_version') AS version,",
  "  pg_postmaster_start_time() AS started,",
  "  extract(epoch FROM now() - pg_postmaster_start_time())::bigint AS up_seconds,",
  "  pg_is_in_recovery() AS standby,",
  "  current_database() AS database,",
  "  current_user AS role,",
  "  pg_has_role('pg_read_all_stats', 'USAGE') AS all_stats,",
  "  pg_has_role('pg_read_all_settings', 'USAGE') AS all_settings,",
  "  (SELECT d.stats_reset FROM pg_stat_database d WHERE d.datname = current_database()) AS stats_reset,",
  "  current_setting('max_connections')::int AS max_connections,",
  `  (SELECT e.extversion FROM pg_extension e WHERE e.extname = ${PGSS}) AS pgss_version,`,
  "  (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace",
  `    WHERE e.extname = ${PGSS}) AS pgss_schema,`,
  `  (SELECT a.default_version FROM pg_available_extensions a WHERE a.name = ${PGSS}) AS pgss_available,`,
  "  (SELECT s.setting FROM pg_settings s WHERE s.name = 'shared_preload_libraries') AS preload,",
  "  current_setting('autovacuum') AS autovacuum,",
  "  current_setting('autovacuum_vacuum_threshold') AS vacuum_threshold,",
  "  current_setting('autovacuum_vacuum_scale_factor') AS vacuum_scale,",
  "  current_setting('autovacuum_analyze_threshold') AS analyze_threshold,",
  "  current_setting('autovacuum_analyze_scale_factor') AS analyze_scale,",
  "  current_setting('autovacuum_freeze_max_age') AS freeze_max_age",
);

/**
 * The server from the probe's one row. An empty value is none, as the psql path printed NULL.
 * @param {string[]} columns
 * @param {(string | null)[]} row
 * @returns {Server}
 */
export function serverOf(columns, row) {
  const get = (/** @type {string} */ name) => {
    const value = row[columns.indexOf(name)];
    return value === undefined || value === "" ? null : value;
  };
  const yes = (/** @type {string} */ name) => ["t", "true", "on"].includes(get(name) ?? "");
  const number = (/** @type {string} */ name) => {
    const value = Number(get(name));
    return get(name) === null || !Number.isFinite(value) ? null : value;
  };
  return {
    versionNum: number("version_num") ?? 0,
    version: get("version") ?? "",
    started: get("started"),
    upSeconds: number("up_seconds"),
    standby: yes("standby"),
    database: get("database") ?? "",
    role: get("role") ?? "",
    allStats: yes("all_stats"),
    allSettings: yes("all_settings"),
    statsReset: get("stats_reset"),
    maxConnections: number("max_connections") ?? 0,
    pgss: {
      version: get("pgss_version"),
      schema: get("pgss_schema"),
      available: get("pgss_available"),
      preload: get("preload"),
    },
    autovacuum: {
      on: yes("autovacuum"),
      vacuumThreshold: get("vacuum_threshold") ?? "50",
      vacuumScale: get("vacuum_scale") ?? "0.2",
      analyzeThreshold: get("analyze_threshold") ?? "50",
      analyzeScale: get("analyze_scale") ?? "0.1",
      freezeMaxAge: get("freeze_max_age") ?? "200000000",
    },
  };
}

/** What the role cannot see, in a sentence, or "" when it sees everything. */
export function blindSpots(/** @type {Server} */ server) {
  const parts = [
    ...(server.allStats
      ? []
      : ["other roles' sessions, transactions and statements show without their details"]),
    ...(server.allSettings ? [] : ["settings only a superuser reads are left out"]),
  ];
  if (parts.length === 0) return "";
  return t("features.overview.probe.isNotAMemberOfPg", {
    value: String(server.role || t("features.overview.probe.thisRole")),
    value2: String(parts.join(", and ")),
  });
}
