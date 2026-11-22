// A source search as the panel and agents hold it: the person's options (an agent's read the same
// way), the run folded schema by schema (each object with its matching lines, the lines kept up to
// one cap for the whole search), the sentence that says what ran, and the answer agents get. No DOM.

import { formatCount, formatDuration } from "../../format.js";
import { KIND_IDS } from "./items.js";

/**
 * @typedef {"schema" | "database" | "all"} Scope
 * @typedef {{
 *   text: string, regex: boolean, ignoreCase: boolean, comments: boolean, scope: Scope,
 *   schema: string, kinds: string[],
 * }} Options
 *   `schema` the one schema of the scope "schema"; `kinds` those searched (items.js KINDS).
 * @typedef {import("./match.js").Line} Line
 * @typedef {{
 *   connection: string, where: string, kind: import("./items.js").Kind, schema: string,
 *   table: string, name: string, ident: string, count: number, lines: Line[], text?: string,
 * }} Hit
 *   `connection` the reference it opens on (`<id>/<database>` for another database), `where` its
 *   name as shown; `text` a part's, a default's or a comment's whole text, which opens as DDL.
 * @typedef {{
 *   phase: "running" | "done" | "cancelled" | "failed", options: Options, started: number,
 *   ms: number, total: number, done: number, current: string, objects: Hit[], lines: number,
 *   kept: number, capped: boolean, notes: string[], error: string,
 * }} Run
 *   `total` schemas to search, `done` so far; `lines` matching lines in all, `kept` those kept.
 */

export const SCOPES = /** @type {const} */ ([
  ["schema", "This schema"],
  ["database", "This database"],
  ["all", "Every connection"],
]);
const SCOPE_IDS = SCOPES.map(([id]) => id);
/** At most this many lines are kept for a whole search. */
export const LINES_CAP = 2000;

/** The options a new search starts from. @returns {Options} */
export const defaults = () => ({
  text: "",
  regex: false,
  ignoreCase: true,
  comments: false,
  scope: "database",
  schema: "",
  kinds: [...KIND_IDS],
});

/**
 * Options from a form's or an agent's fields over a base; unknown fields are dropped.
 * @param {Record<string, unknown>} fields
 * @param {Options} base
 * @returns {Options}
 */
export function optionsOf(fields, base) {
  const flag = (/** @type {string} */ name, /** @type {boolean} */ was) =>
    typeof fields[name] === "boolean" ? /** @type {boolean} */ (fields[name]) : was;
  const kinds = Array.isArray(fields.kinds)
    ? fields.kinds.filter((k) => typeof k === "string" && KIND_IDS.includes(k))
    : base.kinds;
  return {
    text: typeof fields.text === "string" ? fields.text : base.text,
    regex: flag("regex", base.regex),
    ignoreCase: flag("ignoreCase", base.ignoreCase),
    comments: flag("comments", base.comments),
    scope: SCOPE_IDS.includes(/** @type {Scope} */ (fields.scope))
      ? /** @type {Scope} */ (fields.scope)
      : base.scope,
    schema: typeof fields.schema === "string" && fields.schema ? fields.schema : base.schema,
    kinds,
  };
}

/** A new run of `total` schemas. @returns {Run} */
export const newRun = (
  /** @type {Options} */ options,
  /** @type {number} */ total,
  /** @type {number} */ now,
) => ({
  phase: "running",
  options,
  started: now,
  ms: 0,
  total,
  done: 0,
  current: "",
  objects: [],
  lines: 0,
  kept: 0,
  capped: false,
  notes: [],
  error: "",
});

/**
 * Fold a schema's hits into a run (a new run: the states told before keep their own lists).
 * @param {Run} run
 * @param {Hit[]} hits
 * @returns {Run}
 */
export function fold(run, hits) {
  let kept = run.kept;
  let capped = run.capped;
  let lines = run.lines;
  const objects = [...run.objects];
  for (const hit of hits) {
    const room = Math.max(0, LINES_CAP - kept);
    if (hit.lines.length > room) capped = true;
    const shown = hit.lines.slice(0, room);
    kept += shown.length;
    lines += hit.count;
    if (hit.lines.length < hit.count) capped = true;
    objects.push({ ...hit, lines: shown });
  }
  return { ...run, objects, kept, capped, lines };
}

const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many) =>
  `${formatCount(n)} ${n === 1 ? one : many}`;

/** The sentence about a run: what it found, in how many schemas, how far it went. */
export function summaryText(/** @type {Run} */ run) {
  const where = plural(run.done, "schema", "schemas");
  const found = run.objects.length
    ? `Found ${plural(run.lines, "line", "lines")} in ${plural(run.objects.length, "object", "objects")} of ${where}`
    : `No match in ${where}`;
  const end =
    run.phase === "cancelled"
      ? `, cancelled after ${formatCount(run.done)} of ${plural(run.total, "schema", "schemas")}`
      : run.phase === "failed"
        ? `; stopped: ${run.error}`
        : `, in ${formatDuration(run.ms)}`;
  return `${found}${end}.`;
}

/** An object's name as an agent reads it: `schema.name`, a part's `schema.table.name`. */
export const objectName = (/** @type {Hit} */ h) =>
  [h.schema, h.table, h.name].filter(Boolean).join(".");

/** What an agent gets back: each object with its count and first lines. */
export function answerOf(/** @type {Run} */ run) {
  return {
    phase: run.phase,
    text: run.options.text,
    regex: run.options.regex,
    scope: run.options.scope,
    objects: run.objects.map((h) => ({
      connection: h.where,
      kind: h.kind,
      object: objectName(h),
      count: h.count,
      lines: h.lines.slice(0, 10).map((l) => ({ line: l.line, text: l.text })),
    })),
    notes: run.notes,
    summary: summaryText(run),
  };
}
