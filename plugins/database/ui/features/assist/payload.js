// What Eris is sent from a console (PG-90, ADR 0345), and the prompt that carries it. The facts are
// the request, the statement, the error's SQLSTATE, message, position and HINT, a plan's nodes and
// the schema in scope (assist/scope.js: names, kinds, types and comments). Rows and values are not
// facts: a sample of the console's last result, and the error's DETAIL and CONTEXT lines (which
// quote rows), go only when the person ticks a sample, and never from a connection tagged
// production unless samples are turned on for it. A typed parameter's value is never read here.
// Everything is cut to a budget, so the prompt stays under brain.ask's 32,000 characters. Pure.

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../engines/common.js").DbError} DbError
 * @typedef {import("../../engines/common.js").ResultSet} ResultSet
 * @typedef {import("../../explain/node.js").PlanNode} PlanNode
 * @typedef {"write" | "explain" | "fix" | "plan"} Task
 * @typedef {{ name: string, type: string, comment?: string }} SentColumn
 * @typedef {{ columns: string[], table: string, refColumns: string[] }} SentKey
 * @typedef {{ name: string, kind: string, comment?: string, columns: SentColumn[], references: SentKey[] }} SentTable
 * @typedef {{ tables: SentTable[], left: number, of: number }} SentSchema
 *   `left` counts the tables in the connection's schema that are not sent, `of` all of them.
 * @typedef {{ code?: string, message: string, position?: number, hint?: string, detail?: string }} SentError
 * @typedef {{ columns: string[], rows: (string | null)[][] }} Sample
 * @typedef {{
 *   task: Task, engine: string, request?: string, statement?: string, error?: SentError,
 *   plan?: Record<string, unknown>, schema: SentSchema, sample?: Sample,
 * }} Facts
 * @typedef {{
 *   task: Task, conn: Connection, request?: string, statement?: string, error?: DbError,
 *   plan?: PlanNode, schema: SentSchema, sample?: ResultSet | null,
 * }} Input
 *   `sample` is the result a ticked sample is taken from; absent, no row and no value line is sent.
 */

export const LIMITS = Object.freeze({
  request: 2000,
  statement: 8000,
  plan: 8000,
  sample: 2000,
  sampleRows: 5,
  cell: 200,
  prompt: 32_000,
});

/** The tool each task's answer comes back through (tools.js). */
export const TOOL_NAMES = Object.freeze({
  write: "propose_sql",
  explain: "explain_sql",
  fix: "fix_sql_error",
  plan: "explain_sql_plan",
});

const ENGINES = /** @type {Record<string, string>} */ ({
  postgresql: "PostgreSQL",
  mysql: "MySQL or MariaDB",
  sqlite: "SQLite",
});

/** Cut `text` to `max` characters, saying so at the cut. */
export function clip(/** @type {string} */ text, /** @type {number} */ max) {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}\n… (${text.length - max} more characters cut)`;
}

/**
 * The error as it is sent: its SQLSTATE, message, position and HINT; its DETAIL, QUERY and
 * CONTEXT lines only with a sample, since they quote rows and values.
 * @param {DbError} error
 * @param {boolean} withValues
 * @returns {SentError}
 */
export function errorFacts(error, withValues) {
  const lines = (error.detail ?? "").split("\n").filter(Boolean);
  const hint = lines
    .filter((line) => line.startsWith("HINT:"))
    .map((line) => line.slice(5).trim())
    .join(" ");
  const others = lines.filter((line) => !line.startsWith("HINT:")).join("\n");
  return {
    ...(error.code ? { code: error.code } : {}),
    message: clip(error.message, 1000),
    ...(error.position !== undefined ? { position: error.position } : {}),
    ...(hint ? { hint: clip(hint, 500) } : {}),
    ...(withValues && others ? { detail: clip(others, 1000) } : {}),
  };
}

/**
 * A sample of a result: its columns and its first rows, each value cut, within LIMITS.sample
 * characters; undefined for a result without rows. NULL stays null.
 * @param {ResultSet} set
 * @returns {Sample | undefined}
 */
export function sampleOf(set) {
  if (!set.rows.length) return undefined;
  const cell = (/** @type {string | null} */ v) => (v === null ? null : clip(v, LIMITS.cell));
  const columns = set.columns.map((c) => clip(c, 64));
  const rows = set.rows.slice(0, LIMITS.sampleRows).map((row) => row.map(cell));
  while (rows.length && JSON.stringify({ columns, rows }).length > LIMITS.sample) rows.pop();
  return rows.length ? { columns, rows } : undefined;
}

/**
 * Whether a sample may go from this connection: never from one tagged production, unless samples
 * are turned on for it.
 * @param {Pick<Connection, "tag">} conn
 * @param {{ production: boolean }} choice
 */
export function sampleAllowed(conn, choice) {
  if (conn.tag === "production" && !choice.production)
    return {
      ok: false,
      why: "This connection is tagged production: no sample goes unless samples are turned on for it.",
    };
  return { ok: true, why: "" };
}

/** One plan node as it is sent: what it is, its conditions, estimates, timings and marks. */
const nodeFacts = (/** @type {PlanNode} */ n) => {
  /** @type {Record<string, unknown>} */
  const out = { node: n.label };
  if (n.detail) out.detail = clip(n.detail, 400);
  if (n.cost !== null) out.cost = n.cost;
  if (n.rows !== null) out.rows = n.rows;
  if (n.actualRows !== null) out.actualRows = n.actualRows;
  if (n.loops !== null && n.loops !== 1) out.loops = n.loops;
  if (n.time !== null) out.ms = n.time;
  if (n.marks.length) out.marks = n.marks.map((m) => m.text);
  return out;
};

/**
 * A plan's nodes as they are sent, depth first, within LIMITS.plan characters: a node past the
 * budget is left out, and its parent says how many were.
 * @param {PlanNode} root
 */
export function planFacts(root) {
  let used = 0;
  /** @returns {Record<string, unknown> | null} */
  const walk = (/** @type {PlanNode} */ n) => {
    const out = nodeFacts(n);
    const size = JSON.stringify(out).length + 16;
    if (used + size > LIMITS.plan) return null;
    used += size;
    const children = [];
    let cut = 0;
    for (const child of n.children) {
      const sent = walk(child);
      if (sent) children.push(sent);
      else cut++;
    }
    if (children.length) out.children = children;
    if (cut) out.nodesCut = cut;
    return out;
  };
  return walk(root) ?? nodeFacts(root);
}

/**
 * The facts of one ask.
 * @param {Input} input
 * @returns {Facts}
 */
export function factsOf(input) {
  const sample = input.sample ? sampleOf(input.sample) : undefined;
  const withValues = Boolean(input.sample);
  return {
    task: input.task,
    engine: ENGINES[input.conn.engine] ?? input.conn.engine,
    ...(input.request ? { request: clip(input.request, LIMITS.request) } : {}),
    ...(input.statement ? { statement: clip(input.statement, LIMITS.statement) } : {}),
    ...(input.error ? { error: errorFacts(input.error, withValues) } : {}),
    ...(input.plan ? { plan: planFacts(input.plan) } : {}),
    schema: input.schema,
    ...(sample ? { sample } : {}),
  };
}

/** What each task asks for. */
const ASKS = /** @type {Record<Task, string>} */ ({
  write:
    "Write SQL for the person's request: one statement, or a short script when it needs more. Use only the tables and columns in the schema below. Prefer a statement that reads; when the request asks for a change, write it, and say in the explanation what it changes.",
  explain:
    "Explain what the statement does, in plain sentences, for the person about to run it: what it reads or changes, in what order, and anything that may surprise them.",
  fix: "The statement failed with the error below. Give the statement fixed, as close to the person's as you can, and say in one or two sentences what was wrong.",
  plan: "Explain the query plan below in plain sentences: where the time goes and why. When an index or a rewrite would help, give it as the suggestion.",
});

/**
 * The prompt: what to do, the rules, and the facts as JSON.
 * @param {Task} task
 * @param {Facts} facts
 */
export function promptOf(task, facts) {
  const { schema } = facts;
  const left =
    schema.left > 0
      ? `The schema is cut to what the statement names and their neighbours by foreign key: ${schema.left} more tables are not sent.`
      : "";
  const lines = [
    `You help a person with SQL in a ${facts.engine} console of their desk. ${ASKS[task]}`,
    `Answer only by calling the tool ${TOOL_NAMES[task]}. Nothing you write is run: the person reads it, may change it, and runs it themselves.`,
    "The schema lists names, types and comments only. No rows or values are sent unless a sample is given.",
    left,
    `Facts:\n${JSON.stringify(facts, null, 1)}`,
  ].filter(Boolean);
  return clip(lines.join("\n\n"), LIMITS.prompt - 64);
}
