// The overview's sizes (sections.js): each database, each schema, the largest tables with their
// heap, indexes and TOAST apart, and the largest indexes with their scans. The size functions take
// a moment's AccessShareLock on each relation and nothing more; a database the role may not
// connect to has no size (pg_database_size refuses it). No DOM.

import { t } from "../../strings/index.js";
import { LIMIT, lines, USER_SCHEMA } from "./sql.js";

/** @typedef {import("./sql.js").Section} Section */

/** Each relation's sizes once: the total, the heap with TOAST (pg_table_size), indexes, TOAST. */
const RELATIONS = lines(
  "SELECT n.nspname, c.relname, c.reltuples,",
  "    pg_total_relation_size(c.oid) AS total,",
  "    pg_table_size(c.oid) AS heap,",
  "    pg_indexes_size(c.oid) AS idx,",
  "    coalesce(pg_total_relation_size(nullif(c.reltoastrelid, 0::oid)), 0) AS toast",
  "  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace",
  `  WHERE c.relkind IN ('r', 'm') AND ${USER_SCHEMA}`,
);

const BYTES = /** @type {const} */ ([
  { key: "total_bytes", label: t("features.overview.sizes.total"), format: "bytes" },
  { key: "table_bytes", label: t("features.overview.sizes.table"), format: "bytes" },
  { key: "index_bytes", label: t("features.overview.sizes.indexes"), format: "bytes" },
  { key: "toast_bytes", label: t("features.overview.sizes.toast"), format: "bytes" },
]);

/** @returns {Section[]} */
export function sizeSections() {
  return [
    {
      id: "databases",
      title: t("features.overview.sizes.databases"),
      source: "pg_database_size(), pg_stat_database",
      counters: "none",
      columns: [
        { key: "database", label: t("features.overview.sizes.database") },
        { key: "size_bytes", label: t("features.overview.sizes.size"), format: "bytes" },
        { key: "connections", label: t("features.overview.sizes.connections"), format: "count" },
      ],
      empty: t("features.overview.sizes.noDatabaseIsListed"),
      sql: lines(
        "SELECT d.datname AS database,",
        "  CASE WHEN has_database_privilege(d.oid, 'CONNECT') OR pg_has_role('pg_read_all_stats', 'USAGE')",
        "    THEN pg_database_size(d.oid) END AS size_bytes,",
        "  s.numbackends AS connections",
        "FROM pg_database d LEFT JOIN pg_stat_database s ON s.datid = d.oid",
        "WHERE NOT d.datistemplate",
        `ORDER BY 2 DESC NULLS LAST, 1 LIMIT ${LIMIT}`,
      ),
    },
    {
      id: "schemas",
      title: t("features.overview.sizes.schemas"),
      source: "pg_total_relation_size(), pg_table_size(), pg_indexes_size()",
      counters: "none",
      columns: [
        { key: "schema", label: t("features.overview.sizes.schema") },
        { key: "tables", label: t("features.overview.sizes.tables"), format: "count" },
        ...BYTES,
      ],
      empty: t("features.overview.sizes.noTableOutsideTheSystemSchemas"),
      sql: lines(
        `WITH r AS (${RELATIONS})`,
        "SELECT nspname AS schema, count(*) AS tables, sum(total) AS total_bytes,",
        "  sum(heap - toast) AS table_bytes, sum(idx) AS index_bytes, sum(toast) AS toast_bytes",
        "FROM r GROUP BY nspname",
        `ORDER BY 3 DESC, 1 LIMIT ${LIMIT}`,
      ),
    },
    {
      id: "tables",
      title: t("features.overview.sizes.tables"),
      source: "pg_total_relation_size(), pg_table_size(), pg_indexes_size(), pg_class.reltuples",
      counters: "none",
      columns: [
        { key: "schema", label: t("features.overview.sizes.schema") },
        { key: "table", label: t("features.overview.sizes.table") },
        {
          key: "rows_estimate",
          label: t("features.overview.sizes.rowsEstimate"),
          format: "estimate",
        },
        ...BYTES,
      ],
      empty: t("features.overview.sizes.noTableOutsideTheSystemSchemas"),
      sql: lines(
        `WITH r AS (${RELATIONS})`,
        'SELECT nspname AS schema, relname AS "table", reltuples::bigint AS rows_estimate,',
        "  total AS total_bytes, heap - toast AS table_bytes, idx AS index_bytes, toast AS toast_bytes",
        "FROM r",
        `ORDER BY 4 DESC, 1, 2 LIMIT ${LIMIT}`,
      ),
    },
    {
      id: "indexes",
      title: t("features.overview.sizes.indexes"),
      source: "pg_relation_size(), pg_stat_all_indexes (idx_scan)",
      counters: "database",
      columns: [
        { key: "schema", label: t("features.overview.sizes.schema") },
        { key: "table", label: t("features.overview.sizes.table") },
        { key: "index", label: t("features.overview.sizes.index") },
        { key: "size_bytes", label: t("features.overview.sizes.size"), format: "bytes" },
        { key: "scans", label: t("features.overview.sizes.scans"), format: "count" },
      ],
      empty: t("features.overview.sizes.noIndexOutsideTheSystemSchemas"),
      sql: lines(
        'SELECT n.nspname AS schema, t.relname AS "table", c.relname AS index,',
        "  pg_relation_size(c.oid) AS size_bytes, s.idx_scan AS scans",
        "FROM pg_index i",
        "JOIN pg_class c ON c.oid = i.indexrelid",
        "JOIN pg_class t ON t.oid = i.indrelid",
        "JOIN pg_namespace n ON n.oid = c.relnamespace",
        "LEFT JOIN pg_stat_all_indexes s ON s.indexrelid = i.indexrelid",
        `WHERE ${USER_SCHEMA}`,
        `ORDER BY 4 DESC NULLS LAST, 1, 3 LIMIT ${LIMIT}`,
      ),
    },
  ];
}
