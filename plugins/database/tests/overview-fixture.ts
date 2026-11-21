// A scripted PostgreSQL server for the overview (ui/features/overview/): a saved connection, the
// probe's answer for a version, an extension state and a role, and each section's rows, matched by
// the section's own SQL for that server. Values are fixture data. The unit tests and the runtime e2e
// page (packages/runtime/e2e/fixture/database.ts) share it; it needs no Node.
import type { Connection } from "../ui/engines/common.js";
import { PROBE_SQL, serverOf } from "../ui/features/overview/probe.js";
import { LOCK_TIMEOUT } from "../ui/features/overview/read.js";
import { sectionsFor } from "../ui/features/overview/sections.js";
import type { Answer, Script } from "./clients";

/** The saved PostgreSQL connection the fixture page adds after the SQLite one. */
export const OVERVIEW_CONNECTION: Connection = {
  id: "c-reports",
  name: "reports",
  engine: "postgresql",
  host: "db.example",
  port: 5432,
  database: "reports",
  user: "app",
  ssl: "default",
  sslCa: "",
  file: "",
  tag: "none",
  readOnly: false,
};

export interface ServerOptions {
  /** The major version: 13, 16 or 17 (the default). */
  version?: 13 | 16 | 17;
  /** pg_stat_statements: created at a version, "none" (available, not created), "unavailable", or
   *  "unloaded" (created, but the server does not load it). The default is 1.11. */
  pgss?: "1.7" | "1.8" | "1.11" | "none" | "unavailable" | "unloaded";
  /** shared_preload_libraries; null: the role may not read it. */
  preload?: string | null;
  standby?: boolean;
  /** The role is a member of pg_read_all_stats and pg_read_all_settings (the default). */
  monitor?: boolean;
  /** Sections whose statement the server refuses: permission denied. */
  deny?: string[];
  /** The probe fails with this. */
  probeError?: string;
}

const RESET = "2026-11-01 09:00:00+00";

/** The probe's columns and one row, as psql would answer them. */
export function probeAnswer(options: ServerOptions = {}): [string[], string[]] {
  const version = options.version ?? 17;
  const pgss = options.pgss ?? "1.11";
  const created = /^\d/u.test(pgss) ? pgss : pgss === "unloaded" ? "1.11" : "";
  const fields: Record<string, string> = {
    version_num: String(version * 10000 + 6),
    version: `${version}.6`,
    started: "2026-11-01 09:00:00+00",
    up_seconds: String(20 * 86400 + 3 * 3600),
    standby: options.standby ? "t" : "f",
    database: "reports",
    role: "app",
    all_stats: options.monitor === false ? "f" : "t",
    all_settings: options.monitor === false ? "f" : "t",
    stats_reset: RESET,
    max_connections: "100",
    pgss_version: created,
    pgss_schema: created ? "public" : "",
    pgss_available: pgss === "unavailable" ? "" : "1.11",
    preload:
      options.preload === null
        ? ""
        : (options.preload ?? (pgss === "unloaded" || pgss === "none" ? "" : "pg_stat_statements")),
    autovacuum: "on",
    vacuum_threshold: "50",
    vacuum_scale: "0.2",
    analyze_threshold: "50",
    analyze_scale: "0.1",
    freeze_max_age: "200000000",
  };
  return [Object.keys(fields), Object.values(fields)];
}

/** A value as psql's CSV writes it. */
const csv = (value: string) => (/[",\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

type Row = Record<string, string>;
const at = (n: number) => `2026-11-${String(n).padStart(2, "0")} 03:12:44+00`;

// biome-ignore format: one row a line, as the sections read them
const ROWS: Record<string, Row[]> = {
  databases: [
    { database: "reports", size_bytes: "1932735283", connections: "18" },
    { database: "archive", size_bytes: "402653184", connections: "2" },
    { database: "postgres", size_bytes: "7802371", connections: "3" },
  ],
  schemas: [
    { schema: "public", tables: "3", total_bytes: "1476395008", table_bytes: "1090519040", index_bytes: "369098752", toast_bytes: "16777216" },
    { schema: "audit", tables: "1", total_bytes: "419430400", table_bytes: "352321536", index_bytes: "67108864", toast_bytes: "0" },
  ],
  tables: [
    { schema: "public", table: "orders", rows_estimate: "240000", total_bytes: "1073741824", table_bytes: "805306368", index_bytes: "251658240", toast_bytes: "16777216" },
    { schema: "audit", table: "events", rows_estimate: "1200000", total_bytes: "419430400", table_bytes: "352321536", index_bytes: "67108864", toast_bytes: "0" },
    { schema: "public", table: "order_items", rows_estimate: "900000", total_bytes: "335544320", table_bytes: "234881024", index_bytes: "100663296", toast_bytes: "0" },
    { schema: "public", table: "customers", rows_estimate: "-1", total_bytes: "67108864", table_bytes: "50331648", index_bytes: "16777216", toast_bytes: "0" },
  ],
  indexes: [
    { schema: "public", table: "orders", index: "orders_pkey", size_bytes: "52428800", scans: "1840022" },
    { schema: "public", table: "orders", index: "orders_customer_idx", size_bytes: "41943040", scans: "220310" },
    { schema: "public", table: "orders", index: "orders_note_idx", size_bytes: "33554432", scans: "0" },
    { schema: "public", table: "order_items", index: "order_items_order_idx", size_bytes: "25165824", scans: "9120" },
    { schema: "public", table: "order_items", index: "order_items_order_id_idx", size_bytes: "25165824", scans: "3" },
  ],
  unused: [
    { schema: "public", table: "orders", index: "orders_note_idx", scans: "0", last_scan: "", size_bytes: "33554432" },
    { schema: "public", table: "order_items", index: "order_items_order_id_idx", scans: "3", last_scan: at(2), size_bytes: "25165824" },
  ],
  duplicates: [
    { schema: "public", table: "order_items", indexes: "order_items_order_id_idx, order_items_order_idx", copies: "2", size_bytes: "50331648" },
  ],
  invalid: [
    { schema: "public", table: "customers", index: "customers_email_idx", state: "built, not valid", size_bytes: "8388608" },
  ],
  seqscans: [
    { schema: "public", table: "customers", seq_scans: "18234", rows_read: "948168000", index_scans: "120", live_rows: "52000", last_seq_scan: at(21) },
    { schema: "audit", table: "events", seq_scans: "40", rows_read: "48000000", index_scans: "8812", live_rows: "1200000", last_seq_scan: at(20) },
  ],
  vacuum: [
    { schema: "public", table: "orders", live_rows: "240000", dead_rows: "38000", dead_percent: "13.7", last_vacuum: "", last_autovacuum: at(20), last_analyze: "", last_autoanalyze: at(20), vacuum_at: "48050", own_settings: "" },
    { schema: "audit", table: "events", live_rows: "1200000", dead_rows: "4100", dead_percent: "0.3", last_vacuum: at(19), last_autovacuum: at(18), last_analyze: at(19), last_autoanalyze: at(18), vacuum_at: "60050", own_settings: "autovacuum_vacuum_scale_factor=0.05" },
    { schema: "public", table: "customers", live_rows: "52000", dead_rows: "12", dead_percent: "0.0", last_vacuum: "", last_autovacuum: at(15), last_analyze: "", last_autoanalyze: "", vacuum_at: "", own_settings: "autovacuum_enabled=false" },
  ],
  wraparound: [
    { database: "reports", xid_age: "182340211", wraparound_percent: "8.49", freeze_percent: "91.2", multixact_age: "1203" },
    { database: "archive", xid_age: "92000000", wraparound_percent: "4.28", freeze_percent: "46.0", multixact_age: "12" },
  ],
  cache: [
    { schema: "public", table: "orders", blocks_read: "81234", blocks_hit: "9123400", hit_percent: "99.12", index_hit_percent: "99.80" },
    { schema: "public", table: "customers", blocks_read: "40211", blocks_hit: "120400", hit_percent: "74.96", index_hit_percent: "97.10" },
  ],
  statements: [
    { total_ms: "482211.52", calls: "120344", mean_ms: "4.007", rows: "120344", hit_percent: "99.91", role: "app", query: "SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT $2", since: RESET },
    { total_ms: "190334.10", calls: "8120", mean_ms: "23.440", rows: "8120", hit_percent: "97.02", role: "app", query: "UPDATE order_items SET qty = $1 WHERE id = $2", since: RESET },
    { total_ms: "88412.00", calls: "24", mean_ms: "3683.833", rows: "24", hit_percent: "61.40", role: "reporter", query: "SELECT count(*) FROM audit.events WHERE at > $1", since: RESET },
  ],
  long: [
    { pid: "4321", role: "reporter", application: "nightly export", state: "idle in transaction", open_seconds: "5400", xmin_age: "18234", query: "SELECT * FROM audit.events" },
  ],
  replication: [
    { standby: "standby-a", address: "192.0.2.10", state: "streaming", sync_state: "async", replay_lag_bytes: "1048576", write_lag_seconds: "0.002", flush_lag_seconds: "0.004", replay_lag_seconds: "0.120", status: "streaming", slot: "standby_a", last_replayed: at(21) },
  ],
  slots: [
    { slot: "export_slot", type: "logical", database: "reports", active: "f", wal_status: "extended", retained_bytes: "805306368", safe_wal_bytes: "" },
    { slot: "standby_a", type: "physical", database: "", active: "t", wal_status: "reserved", retained_bytes: "1048576", safe_wal_bytes: "" },
  ],
  settings: [
    { name: "listen_addresses", setting: "*", unit: "", default_value: "localhost", source: "command line", pending_restart: "f" },
    { name: "log_min_duration_statement", setting: "500", unit: "ms", default_value: "-1", source: "configuration file", pending_restart: "f" },
    { name: "max_wal_size", setting: "4096", unit: "MB", default_value: "1024", source: "configuration file", pending_restart: "f" },
    { name: "random_page_cost", setting: "1.1", unit: "", default_value: "4", source: "database", pending_restart: "f" },
    { name: "shared_buffers", setting: "131072", unit: "8kB", default_value: "16384", source: "configuration file", pending_restart: "t" },
    { name: "work_mem", setting: "16384", unit: "kB", default_value: "4096", source: "configuration file", pending_restart: "f" },
  ],
};

/** The server's figures, with its checkpoints' view by version. */
function figures(version: number): Row[] {
  const checkpoints = version >= 17 ? "pg_stat_checkpointer" : "pg_stat_bgwriter";
  const row = (figure: string, value: string, unit: string, statistic: string, since = "") => ({
    figure,
    value,
    unit,
    statistic,
    since,
  });
  return [
    row(
      "Version",
      `PostgreSQL ${version}.6 on x86_64-pc-linux-gnu, compiled by gcc 12.2.0, 64-bit`,
      "text",
      "version()",
    ),
    row("Connections in use", "23", "count", "pg_stat_activity"),
    row("Connection limit", "100", "count", "pg_settings (max_connections)"),
    row("Reserved for superusers", "3", "count", "pg_settings (superuser_reserved_connections)"),
    row("Active sessions", "4", "count", "pg_stat_activity"),
    row("Idle in a transaction", "1", "count", "pg_stat_activity"),
    row("Cache hit ratio", "99.12", "percent", "pg_stat_database", RESET),
    row("Commits", "1843920", "count", "pg_stat_database", RESET),
    row("Rollbacks", "211", "count", "pg_stat_database", RESET),
    row("Deadlocks", "0", "count", "pg_stat_database", RESET),
    row("Temporary files written", "268435456", "bytes", "pg_stat_database", RESET),
    row("Checkpoints on schedule", "4120", "count", checkpoints, RESET),
    row("Checkpoints requested", "12", "count", checkpoints, RESET),
  ];
}

/**
 * The overview's server in front of another script (the fixture's sqlite3 answers, or none):
 * the probe, the lock timeout and each section of the server the options describe.
 */
export function overviewServer(base: Script = () => ({}), options: ServerOptions = {}): Script {
  const [names, values] = probeAnswer(options);
  const sections = sectionsFor(serverOf(names, values));
  const bySql = new Map(sections.flatMap((s) => (s.sql ? [[s.sql, s] as const] : [])));
  const version = options.version ?? 17;
  return (sql, env): Answer | "auth" => {
    const text = sql.trim();
    if (text === PROBE_SQL)
      return options.probeError
        ? { error: options.probeError }
        : { rows: [names, values.map(csv)] };
    if (text === LOCK_TIMEOUT) return { rows: [["set_config"], ["2s"]] };
    const section = bySql.get(text);
    if (!section) return base(sql, env);
    if (options.deny?.includes(section.id))
      return {
        error: `permission denied for ${section.id === "statements" ? "view pg_stat_statements" : "table orders"}`,
      };
    if (section.id === "statements" && options.pgss === "unloaded")
      return { error: 'pg_stat_statements must be loaded via "shared_preload_libraries"' };
    const rows = section.id === "server" ? figures(version) : (ROWS[section.id] ?? []);
    const head = [
      ...section.columns.map((c) => c.key),
      ...(section.id === "server" ? ["unit"] : []),
      ...(/ AS since\b/u.test(text) && section.id === "statements" ? ["since"] : []),
    ];
    return { rows: [head, ...rows.map((row) => head.map((key) => csv(row[key] ?? "")))] };
  };
}
