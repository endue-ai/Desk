// PostgreSQL on the core's sessions (engines/pg-session.js, ADR 0281): no client program, and no
// plan of a client's invocation. What the plugin's other modules ask of an engine stays here: its
// title, dialect and port, the version query, EXPLAIN, and the catalog's queries.

import { quoteText } from "../sql/quote.js";
import { t } from "../strings/index.js";

export const postgres = {
  id: /** @type {const} */ ("postgresql"),
  title: t("engines.postgres.postgresql"),
  dialect: /** @type {const} */ ("postgresql"),
  port: 5432,
  /** Its statements run on a session through the bridge, not in a client. */
  session: /** @type {const} */ (true),
  versionSql: "SELECT version()",
  explain: (/** @type {string} */ text) => `EXPLAIN ${text}`,
  catalog: {
    schemas: (/** @type {boolean} */ system) =>
      `SELECT nspname FROM pg_catalog.pg_namespace${
        system ? "" : " WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'"
      } ORDER BY nspname`,
    columns: (/** @type {string} */ schema, /** @type {string} */ table) =>
      "SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), " +
      "CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END, pg_catalog.pg_get_expr(d.adbin, d.adrelid), " +
      "CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indrelid = c.oid " +
      "AND i.indisprimary AND a.attnum = ANY (i.indkey)) THEN 'YES' ELSE 'NO' END " +
      "FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid " +
      "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
      "LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum " +
      `WHERE n.nspname = ${quoteText("postgresql", schema)} ` +
      `AND c.relname = ${quoteText("postgresql", table)} ` +
      "AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum",
  },
  /** DDL takes part in a transaction, so a dry run can hold it. */
  ddlCommits: false,
};
