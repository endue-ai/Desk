// A search as the panel and agents hold it: the person's options with their limits (an agent's
// clamped the same), the results folded table by table (counts per column, the hits kept up to one
// cap for the whole search), the sentences that say what ran, and the answer agents get. No DOM.

import { formatCount, formatDuration } from "../../format.js";
import { FAMILY_IDS, MATCH_IDS } from "./columns.js";
import { keyWidth } from "./sql.js";

/**
 * @typedef {import("./columns.js").Family} Family
 * @typedef {import("./columns.js").Match} Match
 * @typedef {import("./columns.js").Searched} Searched
 * @typedef {import("./sql.js").Key} Key
 * @typedef {{
 *   value: string, match: Match, ignoreCase: boolean, schemas: string[], tables: string,
 *   families: Family[], rowLimit: number, timeoutSeconds: number, sizeLimit: number, big: boolean,
 * }} Options
 *   `tables`: names (or schema.name), comma separated, `*` for any run of characters; "" is every
 *   table. `sizeLimit`: tables estimated past it are left out unless `big`.
 * @typedef {{ key: (string | null)[], text: string }} Hit
 * @typedef {{ name: string, type: string, family: Family, count: number, where: string, hits: Hit[] }} ColumnHits
 * @typedef {{
 *   schema: string, name: string, scan: "index" | "full" | "", key: Key, more: boolean,
 *   rows: number, columns: ColumnHits[],
 * }} TableHits
 *   `rows`: the rows that matched, up to the row limit (`more`: there were more).
 * @typedef {"size" | "permission" | "timeout" | "failed" | "cancelled"} Why
 * @typedef {{ schema: string, name: string, why: Why, detail: string }} Skipped
 * @typedef {{
 *   phase: "running" | "done" | "cancelled" | "failed", options: Options, total: number, done: number,
 *   current: string, tables: TableHits[], skipped: Skipped[], empty: number, kept: number,
 *   capped: boolean, error: string, started: number, ms: number,
 * }} Run
 *   `total` tables to search, `done` searched or skipped so far; `empty` had no column that can
 *   hold the value; `kept` hits kept against HIT_CAP.
 */

/** At most this many hits are kept for a whole search; past it only counts are. */
export const HIT_CAP = 1000;
/** The limits of each number the form takes: least, most, default. */
export const LIMITS = /** @type {const} */ ({
  rowLimit: [1, 1000, 100],
  timeoutSeconds: [1, 300, 10],
  sizeLimit: [1, 1_000_000_000_000, 1_000_000],
});

/** The options a new search starts from. @returns {Options} */
export const defaults = () => ({
  value: "",
  match: "equals",
  ignoreCase: false,
  schemas: [],
  tables: "",
  families: [...FAMILY_IDS],
  rowLimit: LIMITS.rowLimit[2],
  timeoutSeconds: LIMITS.timeoutSeconds[2],
  sizeLimit: LIMITS.sizeLimit[2],
  big: false,
});

const clamp = (/** @type {unknown} */ value, /** @type {readonly number[]} */ limits) => {
  const [least, most, fallback] = /** @type {[number, number, number]} */ (limits);
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(most, Math.max(least, n)) : fallback;
};
const strings = (/** @type {unknown} */ value) =>
  Array.isArray(value) ? value.filter((v) => typeof v === "string") : undefined;

/**
 * Options from a form's or an agent's fields over a base: unknown fields dropped, numbers held to
 * their limits, so whoever asks searches under the same ones.
 * @param {Record<string, unknown>} fields
 * @param {Options} base
 * @returns {Options}
 */
export function optionsOf(fields, base) {
  const families = strings(fields.types ?? fields.families)?.filter((f) =>
    FAMILY_IDS.includes(/** @type {Family} */ (f)),
  );
  const tables = Array.isArray(fields.tables)
    ? strings(fields.tables)?.join(", ")
    : typeof fields.tables === "string"
      ? fields.tables
      : undefined;
  const has = (/** @type {string} */ name) => fields[name] !== undefined && fields[name] !== null;
  return {
    value: typeof fields.value === "string" ? fields.value : base.value,
    match: MATCH_IDS.includes(/** @type {Match} */ (fields.match))
      ? /** @type {Match} */ (fields.match)
      : base.match,
    ignoreCase: typeof fields.ignoreCase === "boolean" ? fields.ignoreCase : base.ignoreCase,
    schemas: strings(fields.schemas) ?? base.schemas,
    tables: (tables ?? base.tables).trim(),
    families: /** @type {Family[]} */ (families ?? base.families),
    rowLimit: has("rowLimit") ? clamp(fields.rowLimit, LIMITS.rowLimit) : base.rowLimit,
    timeoutSeconds: has("timeoutSeconds")
      ? clamp(fields.timeoutSeconds, LIMITS.timeoutSeconds)
      : base.timeoutSeconds,
    sizeLimit: has("sizeLimit") ? clamp(fields.sizeLimit, LIMITS.sizeLimit) : base.sizeLimit,
    big: typeof fields.big === "boolean" ? fields.big : base.big,
  };
}

/**
 * Fold one table's rows into the run: counts per column, hits kept while the cap has room.
 * @param {Run} run
 * @param {{ schema: string, name: string, scan: TableHits["scan"], key: Key }} table
 * @param {Searched[]} columns
 * @param {string[]} conditions each column's condition, for opening its matches
 * @param {(string | null)[][]} rows the search's rows, at most the row limit and one more
 */
export function fold(run, table, columns, conditions, rows) {
  const limit = run.options.rowLimit;
  const kept = rows.slice(0, limit);
  const width = keyWidth(table.key);
  /** @type {ColumnHits[]} */
  const hits = [];
  // A column's field is its text after the mark `=` where it matched, NULL (or nothing) where not.
  columns.forEach((column, i) => {
    const matched = kept.filter((row) => (row[width + i] ?? "") !== "");
    if (matched.length === 0) return;
    const room = Math.max(0, HIT_CAP - run.kept);
    if (matched.length > room) run.capped = true;
    const shown = matched.slice(0, room).map((row) => ({
      key: row.slice(0, width),
      text: String(row[width + i]).slice(1),
    }));
    run.kept += shown.length;
    hits.push({
      name: column.name,
      type: column.type,
      family: column.family,
      count: matched.length,
      where: conditions[i] ?? "",
      hits: shown,
    });
  });
  if (hits.length === 0) return;
  run.tables.push({ ...table, more: rows.length > limit, rows: kept.length, columns: hits });
}

const WHY = {
  size: "over the size limit",
  permission: "no permission to read it",
  timeout: "past its timeout",
  failed: "failed",
  cancelled: "cancelled",
};
/** Why a table was not searched, in words. */
export const whyText = (/** @type {Skipped} */ s) =>
  s.detail && s.why !== "cancelled" ? `${WHY[s.why]}: ${s.detail}` : WHY[s.why];

/** A count, with + when the row limit stopped it. */
export const countText = (/** @type {number} */ n, /** @type {boolean} */ more) =>
  `${formatCount(n)}${more ? "+" : ""} ${n === 1 && !more ? "row" : "rows"}`;

/** How many tables a run read: not those left out, nor those with no column to look in. */
export const searchedOf = (/** @type {Run} */ run) =>
  Math.max(0, run.done - run.skipped.length - run.empty);

/** The sentence about a run: what it found, where, how far it went. */
export function summaryText(/** @type {Run} */ run) {
  const rows = run.tables.reduce((n, t) => n + t.rows, 0);
  const more = run.tables.some((t) => t.more);
  const columns = run.tables.reduce((n, t) => n + t.columns.length, 0);
  const searched = searchedOf(run);
  const tables = (/** @type {number} */ n) => `${formatCount(n)} ${n === 1 ? "table" : "tables"}`;
  const found =
    run.tables.length === 0
      ? "No match"
      : `Found ${countText(rows, more)} in ${tables(run.tables.length)} (${formatCount(columns)} ${columns === 1 ? "column" : "columns"})`;
  const out = run.skipped.filter((s) => s.why !== "cancelled").length;
  const left = out ? `, ${formatCount(out)} left out` : "";
  const end =
    run.phase === "cancelled"
      ? `cancelled after ${formatCount(run.done)} of ${tables(run.total)}`
      : run.phase === "failed"
        ? `stopped: ${run.error}`
        : `in ${formatDuration(run.ms)}`;
  return `${found}; ${tables(searched)} searched${left}, ${end}.`;
}

/** What an agent gets back: per table and column the count and the first keys, and what was left. */
export function answerOf(/** @type {Run} */ run) {
  return {
    phase: run.phase,
    value: run.options.value,
    match: run.options.match,
    ignoreCase: run.options.ignoreCase,
    searched: searchedOf(run),
    tables: run.tables.map((t) => ({
      table: `${t.schema}.${t.name}`,
      scan: t.scan || "unknown",
      rowsBy: t.key.by === "key" ? t.key.columns : t.key.by,
      columns: t.columns.map((c) => ({
        column: c.name,
        count: c.count,
        more: t.more,
        rows: c.hits.slice(0, 10).map((h) => h.key),
      })),
    })),
    skipped: run.skipped.map((s) => ({ table: `${s.schema}.${s.name}`, why: whyText(s) })),
    ...(run.capped ? { note: `Only the first ${formatCount(HIT_CAP)} hits were kept.` } : {}),
    ...(run.error ? { error: run.error } : {}),
    summary: summaryText(run),
  };
}
