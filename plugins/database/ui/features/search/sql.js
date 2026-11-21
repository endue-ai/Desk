// The statements of a search, by engine: a first run that reads the server's version (and tries a
// regular expression once, so a bad one is said before any table is read), then one run per table:
// a read-only transaction with its own statement timeout, EXPLAIN of the search (which says whether
// an index serves it), and the search itself: the row's key (its primary key; else PostgreSQL's
// ctid, SQLite's rowid), each searched column's text where it matched (after a mark, `=`, so a match
// on an empty text is never read as NULL), at most the row limit and one more. A failure is read as
// no permission, past the timeout, or the server's words. Pure.

import { quoteName, quoteText } from "../../sql/quote.js";
import { mysqlCondition, otherExcerpt, sqliteCondition } from "./sql-others.js";
import { postgresCondition, postgresExcerpt } from "./sql-postgres.js";

/**
 * @typedef {import("../../engines/common.js").EngineId} EngineId
 * @typedef {import("../../engines/common.js").DbError} DbError
 * @typedef {import("./columns.js").Searched} Searched
 * @typedef {import("./sql-postgres.js").How} How
 * @typedef {{ version: number, flavor: "" | "mysql" | "mariadb" }} Server
 * @typedef {"key" | "ctid" | "rowid" | "match"} By
 *   How a hit names its row: its primary key, its ctid (PostgreSQL), its rowid (SQLite), or, on
 *   MySQL without a key, the column's condition.
 * @typedef {{ by: By, columns: string[], partitioned: boolean }} Key
 * @typedef {{ schema: string, name: string, from: string }} Target
 */

/** How much of a matched value a hit keeps. */
export const EXCERPT = 120;

/** The first run: the server's version, and the regular expression tried once. */
export function preflight(/** @type {EngineId} */ engine, /** @type {How} */ how) {
  const version =
    engine === "postgresql"
      ? "SELECT current_setting('server_version_num')"
      : engine === "mysql"
        ? "SELECT VERSION()"
        : "SELECT sqlite_version()";
  if (how.match !== "regex") return [version];
  const v = quoteText(engine, how.value);
  const probe =
    engine === "postgresql"
      ? `'' ${how.ignoreCase ? "~*" : "~"} ${v}`
      : engine === "mysql"
        ? `'' REGEXP ${quoteText("mysql", `${how.ignoreCase ? "(?i)" : "(?-i)"}${how.value}`)}`
        : how.ignoreCase
          ? `regexpi(${v}, '')`
          : `'' REGEXP ${v}`;
  return [version, `SELECT ${probe}`];
}

/** What the first run's version row says. @returns {Server} */
export function serverOf(/** @type {EngineId} */ engine, /** @type {string} */ text) {
  if (engine === "postgresql") return { version: Number(text) || 0, flavor: "" };
  if (engine === "mysql")
    return { version: 0, flavor: /mariadb/iu.test(text) ? "mariadb" : "mysql" };
  return { version: 0, flavor: "" };
}

/**
 * The condition that a column holds the value, on any engine.
 * @param {EngineId} engine
 * @param {Searched} column
 * @param {How} how
 * @param {number} version PostgreSQL's server_version_num
 */
export function conditionOf(engine, column, how, version) {
  if (engine === "postgresql") return postgresCondition(column, how, version);
  if (engine === "mysql") return mysqlCondition(column, how);
  return sqliteCondition(column, how);
}

/**
 * How a hit names its row on a table with these key columns.
 * @param {EngineId} engine
 * @param {string[]} primary the primary key's columns, in order
 * @param {boolean} partitioned
 * @returns {Key}
 */
export function keyOf(engine, primary, partitioned) {
  if (primary.length > 0) return { by: "key", columns: primary, partitioned };
  if (engine === "postgresql") return { by: "ctid", columns: [], partitioned };
  if (engine === "sqlite") return { by: "rowid", columns: [], partitioned };
  return { by: "match", columns: [], partitioned };
}

/** The key's expressions at the head of the select list. */
function keyList(/** @type {EngineId} */ engine, /** @type {Key} */ key) {
  if (key.by === "key") return key.columns.map((c) => quoteName(engine, c));
  if (key.by === "ctid")
    return key.partitioned ? ["ctid::text", "tableoid::regclass::text"] : ["ctid::text"];
  if (key.by === "rowid") return ["rowid"];
  return [];
}

/** How many of a row's first fields are its key. */
export const keyWidth = (/** @type {Key} */ key) =>
  key.by === "key"
    ? key.columns.length
    : key.by === "ctid"
      ? key.partitioned
        ? 2
        : 1
      : key.by === "rowid"
        ? 1
        : 0;

/**
 * The search of one table: its key, each column's text where it matched, at most `limit` + 1 rows.
 * @param {EngineId} engine
 * @param {Target} target
 * @param {Searched[]} columns
 * @param {Key} key
 * @param {{ how: How, limit: number, server: Server }} options
 */
export function selectOf(engine, target, columns, key, options) {
  const conditions = columns.map((c) =>
    conditionOf(engine, c, options.how, options.server.version),
  );
  const excerpt = (/** @type {Searched} */ c) =>
    engine === "postgresql" ? postgresExcerpt(c, EXCERPT) : otherExcerpt(engine, c, EXCERPT);
  const list = [
    ...keyList(engine, key),
    ...columns.map((c, i) => `CASE WHEN ${conditions[i]} THEN ${excerpt(c)} END`),
  ];
  const where = conditions.map((c) => `(${c})`).join(" OR ");
  const sql = `SELECT ${list.join(", ")} FROM ${target.from} WHERE ${where} LIMIT ${options.limit + 1}`;
  return { sql, conditions };
}

/**
 * The statements of one table's run: read-only, its own timeout, EXPLAIN, the search.
 * @param {EngineId} engine
 * @param {string} select
 * @param {{ timeoutMs: number, server: Server }} options
 * @returns {{ statements: string[], explain: number, search: number }}
 */
export function tableRun(engine, select, options) {
  const ms = Math.max(1, Math.round(options.timeoutMs));
  if (engine === "postgresql")
    return {
      statements: [
        "BEGIN READ ONLY",
        `SET LOCAL statement_timeout = ${ms}`,
        `EXPLAIN ${select}`,
        select,
        "COMMIT",
      ],
      explain: 2,
      search: 3,
    };
  if (engine === "mysql") {
    const limit =
      options.server.flavor === "mariadb"
        ? `SET SESSION max_statement_time = ${Math.max(1, Math.ceil(ms / 1000))}`
        : `SET SESSION max_execution_time = ${ms}`;
    return {
      statements: [limit, "START TRANSACTION READ ONLY", `EXPLAIN ${select}`, select, "COMMIT"],
      explain: 2,
      search: 3,
    };
  }
  return {
    statements: ["PRAGMA query_only = 1", `EXPLAIN QUERY PLAN ${select}`, select],
    explain: 1,
    search: 2,
  };
}

/**
 * Whether EXPLAIN's rows show an index serving the search, a scan of the whole table, or neither.
 * @param {EngineId} engine
 * @param {{ columns: string[], rows: (string | null)[][] } | undefined} set
 * @returns {"index" | "full" | ""}
 */
export function scanOf(engine, set) {
  if (!set) return "";
  if (engine === "mysql") {
    const at = set.columns.findIndex((c) => c.toLowerCase() === "type");
    const types = set.rows.map((r) => (at >= 0 ? (r[at] ?? "") : ""));
    if (types.some((t) => t === "ALL")) return "full";
    return types.some((t) => t !== "") ? "index" : "";
  }
  const lines = set.rows.map((r) => r.filter((v) => v !== null).join(" "));
  const full = engine === "postgresql" ? /\bSeq Scan\b/u : /^\s*SCAN\b|\bSCAN (?:TABLE )?\S+$/u;
  const index =
    engine === "postgresql"
      ? /\bIndex (?:Only )?Scan\b/u
      : /\bUSING (?:COVERING )?INDEX\b|\bUSING INTEGER PRIMARY KEY\b/u;
  if (lines.some((l) => full.test(l))) return "full";
  return lines.some((l) => index.test(l)) ? "index" : "";
}

/**
 * Why a table's search failed: no permission, past its timeout, or the server's words.
 * @param {DbError} error
 * @returns {{ why: "permission" | "timeout" | "failed", detail: string }}
 */
export function whyOf(error) {
  const text = `${error.code ?? ""} ${error.message}`;
  if (
    error.kind === "timeout" ||
    /57014|statement timeout|max_execution_time|max_statement_time|maximum statement execution time/iu.test(
      text,
    )
  )
    return { why: "timeout", detail: error.message };
  if (/42501|permission denied|command denied|access denied/iu.test(text))
    return { why: "permission", detail: error.message };
  return { why: "failed", detail: error.message };
}

/**
 * The table view's filter that finds one hit's row.
 * @param {EngineId} engine
 * @param {Key} key
 * @param {(string | null)[]} values the key's fields of the hit
 * @param {string} condition the column's condition, for a row without a key
 */
export function rowFilter(engine, key, values, condition) {
  const lit = (/** @type {string | null} */ v) => (v === null ? "NULL" : quoteText(engine, v));
  if (key.by === "key")
    return key.columns
      .map((c, i) => `${quoteName(engine, c)} = ${lit(values[i] ?? null)}`)
      .join(" AND ");
  if (key.by === "ctid") {
    const ctid = `ctid = ${lit(values[0] ?? "")}::tid`;
    return key.partitioned ? `${ctid} AND tableoid = ${lit(values[1] ?? "")}::regclass` : ctid;
  }
  if (key.by === "rowid") return `rowid = ${/^\d+$/u.test(values[0] ?? "") ? values[0] : "NULL"}`;
  return condition;
}
