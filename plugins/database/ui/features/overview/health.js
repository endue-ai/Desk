// The overview's health of tables and indexes (sections.js): indexes scanned fewer than 50 times
// since the statistics were reset (those behind a constraint left out: they enforce it), duplicate
// and invalid indexes, tables read by sequential scans, dead rows with the last vacuum and analyze
// and when autovacuum comes, each database's transaction id age against wraparound, and cache hits.
// Counts are this server's own: a standby's are not its primary's. No DOM.

import { t } from "../../strings/index.js";
import { LIMIT, lines, since, USER_SCHEMA } from "./sql.js";

/**
 * @typedef {import("./sql.js").Section} Section
 * @typedef {import("./probe.js").Server} Server
 */

/** Rarely scanned: fewer scans than this since the statistics were reset. */
export const RARELY = 50;
/** Transaction ids before wraparound. */
export const WRAPAROUND = 2147483648;

const INDEX_JOIN = lines(
  "FROM pg_index i",
  "JOIN pg_class c ON c.oid = i.indexrelid",
  "JOIN pg_class t ON t.oid = i.indrelid",
  "JOIN pg_namespace n ON n.oid = t.relnamespace",
);

const WHERE_TABLE = [
  { key: "schema", label: t("features.overview.health.schema") },
  { key: "table", label: t("features.overview.health.table") },
];

/** An autovacuum reloption of a table, as text (`o.x` holds each of them). */
const option = (/** @type {string} */ name) =>
  `max(CASE WHEN o.x LIKE '${name}=%' THEN split_part(o.x, '=', 2) END)`;
const global = (/** @type {string} */ name) => `current_setting('${name}')::float8`;

/** @param {Server} server @returns {Section[]} */
export function indexSections(server) {
  const lastScan = since(server, 16);
  return [
    {
      id: "unused",
      title: t("features.overview.health.unusedIndexes"),
      source: "pg_stat_user_indexes (idx_scan)",
      counters: "database",
      columns: [
        ...WHERE_TABLE,
        { key: "index", label: t("features.overview.health.index") },
        { key: "scans", label: t("features.overview.health.scans"), format: "count" },
        ...(lastScan
          ? [
              {
                key: "last_scan",
                label: t("features.overview.health.lastScan"),
                format: /** @type {const} */ ("time"),
              },
            ]
          : []),
        { key: "size_bytes", label: t("features.overview.health.size"), format: "bytes" },
      ],
      empty: t("features.overview.health.everyIndexWasScannedAtLeast", { RARELY: String(RARELY) }),
      sql: lines(
        'SELECT s.schemaname AS schema, s.relname AS "table", s.indexrelname AS index, s.idx_scan AS scans,',
        lastScan && "  s.last_idx_scan AS last_scan,",
        "  pg_relation_size(s.indexrelid) AS size_bytes",
        "FROM pg_stat_user_indexes s JOIN pg_index i ON i.indexrelid = s.indexrelid",
        `WHERE s.idx_scan < ${RARELY} AND NOT i.indisunique`,
        "  AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = s.indexrelid)",
        `ORDER BY s.idx_scan, size_bytes DESC, 1, 3 LIMIT ${LIMIT}`,
      ),
    },
    {
      id: "duplicates",
      title: t("features.overview.health.duplicateIndexes"),
      source: "pg_index (columns, operator classes, collations, expressions, predicate)",
      counters: "none",
      columns: [
        ...WHERE_TABLE,
        { key: "indexes", label: t("features.overview.health.indexes") },
        { key: "copies", label: t("features.overview.health.copies"), format: "count" },
        { key: "size_bytes", label: t("features.overview.health.size"), format: "bytes" },
      ],
      empty: t("features.overview.health.noTwoIndexesOfATable"),
      sql: lines(
        'SELECT n.nspname AS schema, t.relname AS "table",',
        "  string_agg(c.relname, ', ' ORDER BY c.relname) AS indexes, count(*) AS copies,",
        "  sum(pg_relation_size(c.oid)) AS size_bytes",
        INDEX_JOIN,
        `WHERE ${USER_SCHEMA}`,
        "GROUP BY n.nspname, t.relname, i.indrelid, i.indkey::text, i.indclass::text, i.indcollation::text,",
        "  coalesce(pg_get_expr(i.indexprs, i.indrelid), ''), coalesce(pg_get_expr(i.indpred, i.indrelid), '')",
        "HAVING count(*) > 1",
        `ORDER BY 5 DESC, 1, 2 LIMIT ${LIMIT}`,
      ),
    },
    {
      id: "invalid",
      title: t("features.overview.health.invalidIndexes"),
      source: "pg_index (indisvalid, indisready)",
      counters: "none",
      columns: [
        ...WHERE_TABLE,
        { key: "index", label: t("features.overview.health.index") },
        { key: "state", label: t("features.overview.health.state") },
        { key: "size_bytes", label: t("features.overview.health.size"), format: "bytes" },
      ],
      empty: t("features.overview.health.everyIndexIsValid"),
      note: t("features.overview.health.anIndexACreateIndexConcurrently"),
      sql: lines(
        'SELECT n.nspname AS schema, t.relname AS "table", c.relname AS index,',
        "  CASE WHEN i.indisready THEN 'built, not valid' ELSE 'not built' END AS state,",
        "  pg_relation_size(c.oid) AS size_bytes",
        INDEX_JOIN,
        `WHERE NOT i.indisvalid AND ${USER_SCHEMA}`,
        `ORDER BY 1, 2, 3 LIMIT ${LIMIT}`,
      ),
    },
  ];
}

/** @param {Server} server @returns {Section[]} */
export function tableSections(server) {
  const lastScan = since(server, 16);
  const av = server.autovacuum;
  return [
    {
      id: "seqscans",
      title: t("features.overview.health.sequentialScans"),
      source: "pg_stat_user_tables (seq_scan, seq_tup_read)",
      counters: "database",
      columns: [
        ...WHERE_TABLE,
        { key: "seq_scans", label: t("features.overview.health.sequentialScans"), format: "count" },
        { key: "rows_read", label: t("features.overview.health.rowsRead"), format: "count" },
        { key: "index_scans", label: t("features.overview.health.indexScans"), format: "count" },
        { key: "live_rows", label: t("features.overview.health.liveRows"), format: "count" },
        ...(lastScan
          ? [
              {
                key: "last_seq_scan",
                label: t("features.overview.health.last"),
                format: /** @type {const} */ ("time"),
              },
            ]
          : []),
      ],
      empty: t("features.overview.health.noTableWasReadByA"),
      sql: lines(
        'SELECT schemaname AS schema, relname AS "table", seq_scan AS seq_scans, seq_tup_read AS rows_read,',
        "  idx_scan AS index_scans, n_live_tup AS live_rows",
        lastScan && "  , last_seq_scan",
        "FROM pg_stat_user_tables WHERE seq_scan > 0",
        "ORDER BY seq_tup_read DESC, seq_scan DESC, 1, 2 LIMIT 20",
      ),
    },
    {
      id: "vacuum",
      title: t("features.overview.health.deadRowsAndVacuum"),
      source: "pg_stat_user_tables, pg_class.reloptions, pg_settings (autovacuum_*)",
      counters: "database",
      columns: [
        ...WHERE_TABLE,
        { key: "live_rows", label: t("features.overview.health.live"), format: "count" },
        { key: "dead_rows", label: t("features.overview.health.dead"), format: "count" },
        { key: "dead_percent", label: t("features.overview.health.dead2"), format: "percent" },
        { key: "last_vacuum", label: t("features.overview.health.lastVacuum"), format: "time" },
        {
          key: "last_autovacuum",
          label: t("features.overview.health.lastAutovacuum"),
          format: "time",
        },
        { key: "last_analyze", label: t("features.overview.health.lastAnalyze"), format: "time" },
        {
          key: "last_autoanalyze",
          label: t("features.overview.health.lastAutoanalyze"),
          format: "time",
        },
        { key: "vacuum_at", label: t("features.overview.health.autovacuumAt"), format: "count" },
        { key: "own_settings", label: t("features.overview.health.ownSettings") },
      ],
      empty: t("features.overview.health.noTableOutsideTheSystemSchemas"),
      note: av.on
        ? t("features.overview.health.autovacuumIsOnATableIs", {
            vacuumThreshold: String(av.vacuumThreshold),
            value: String(percent(av.vacuumScale)),
            analyzeThreshold: String(av.analyzeThreshold),
            value2: String(percent(av.analyzeScale)),
          })
        : t("features.overview.health.autovacuumIsOffOnThisServer"),
      sql: lines(
        'SELECT s.schemaname AS schema, s.relname AS "table", s.n_live_tup AS live_rows, s.n_dead_tup AS dead_rows,',
        "  round(100.0 * s.n_dead_tup / nullif(s.n_live_tup + s.n_dead_tup, 0), 1) AS dead_percent,",
        "  s.last_vacuum, s.last_autovacuum, s.last_analyze, s.last_autoanalyze,",
        "  CASE WHEN lower(coalesce(o.enabled, 'on')) IN ('false', 'off', 'no', '0') THEN NULL",
        `    ELSE (coalesce(o.threshold::float8, ${global("autovacuum_vacuum_threshold")})`,
        `      + coalesce(o.scale::float8, ${global("autovacuum_vacuum_scale_factor")}) * greatest(c.reltuples, 0))::bigint`,
        "  END AS vacuum_at,",
        "  o.own AS own_settings",
        "FROM pg_stat_user_tables s JOIN pg_class c ON c.oid = s.relid",
        "CROSS JOIN LATERAL (",
        `  SELECT ${option("autovacuum_enabled")} AS enabled,`,
        `    ${option("autovacuum_vacuum_threshold")} AS threshold,`,
        `    ${option("autovacuum_vacuum_scale_factor")} AS scale,`,
        "    string_agg(o.x, ' ') FILTER (WHERE o.x LIKE 'autovacuum%' OR o.x LIKE 'toast.autovacuum%') AS own",
        "  FROM unnest(coalesce(c.reloptions, '{}'::text[])) AS o(x)",
        ") o",
        `ORDER BY s.n_dead_tup DESC, 1, 2 LIMIT ${LIMIT}`,
      ),
    },
    {
      id: "wraparound",
      title: t("features.overview.health.transactionIdAge"),
      source: "pg_database (datfrozenxid, datminmxid), pg_settings (autovacuum_freeze_max_age)",
      counters: "none",
      columns: [
        { key: "database", label: t("features.overview.health.database") },
        { key: "xid_age", label: t("features.overview.health.age"), format: "count" },
        {
          key: "wraparound_percent",
          label: t("features.overview.health.ofWraparound"),
          format: "percent",
        },
        {
          key: "freeze_percent",
          label: t("features.overview.health.ofFreezeMaxAge"),
          format: "percent",
        },
        {
          key: "multixact_age",
          label: t("features.overview.health.multixactAge"),
          format: "count",
        },
      ],
      empty: t("features.overview.health.noDatabaseIsListed"),
      note: t("features.overview.health.wraparoundComesAtTransactionIdsAutovacuum", {
        value: String(WRAPAROUND.toLocaleString("en-US")),
        value2: String(Number(av.freezeMaxAge).toLocaleString("en-US")),
      }),
      sql: lines(
        "SELECT datname AS database, age(datfrozenxid) AS xid_age,",
        `  round(100.0 * age(datfrozenxid) / ${WRAPAROUND}, 2) AS wraparound_percent,`,
        "  round(100.0 * age(datfrozenxid) / current_setting('autovacuum_freeze_max_age')::numeric, 1) AS freeze_percent,",
        "  mxid_age(datminmxid) AS multixact_age",
        `FROM pg_database ORDER BY 2 DESC, 1 LIMIT ${LIMIT}`,
      ),
    },
    {
      id: "cache",
      title: t("features.overview.health.cacheHits"),
      source: "pg_statio_user_tables (heap_blks_hit, heap_blks_read, idx_blks_*)",
      counters: "database",
      columns: [
        ...WHERE_TABLE,
        { key: "blocks_read", label: t("features.overview.health.blocksRead"), format: "count" },
        { key: "blocks_hit", label: t("features.overview.health.blocksHit"), format: "count" },
        { key: "hit_percent", label: t("features.overview.health.hit"), format: "percent" },
        {
          key: "index_hit_percent",
          label: t("features.overview.health.indexHit"),
          format: "percent",
        },
      ],
      empty: t("features.overview.health.noTableWasRead"),
      sql: lines(
        'SELECT schemaname AS schema, relname AS "table", heap_blks_read AS blocks_read, heap_blks_hit AS blocks_hit,',
        "  round(100.0 * heap_blks_hit / nullif(heap_blks_hit + heap_blks_read, 0), 2) AS hit_percent,",
        "  round(100.0 * idx_blks_hit / nullif(idx_blks_hit + idx_blks_read, 0), 2) AS index_hit_percent",
        "FROM pg_statio_user_tables WHERE heap_blks_hit + heap_blks_read > 0",
        "ORDER BY heap_blks_read + coalesce(idx_blks_read, 0) DESC, 1, 2 LIMIT 20",
      ),
    },
  ];
}

/** A scale factor (0.2) as a percentage (20%). */
const percent = (/** @type {string} */ factor) => `${Math.round(Number(factor) * 1000) / 10}%`;
