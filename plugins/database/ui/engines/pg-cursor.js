// A console's single read through a scroll cursor on its kept session (PG-22, ADR 0352): the read
// is declared once (`DECLARE endue_desk_rows SCROLL CURSOR FOR ...`) and its rows come a page at a
// time as the grid asks (`MOVE ABSOLUTE` and `FETCH FORWARD`), never by running it again; `MOVE
// FORWARD ALL` counts every row. Outside a transaction the cursor lives in one of the plugin's own,
// which the header does not show; inside the person's it is theirs. The cursor ends before any other
// run on the session (`END` of the plugin's own transaction, else `CLOSE`), at a read that fits
// one page, and at a cancel or an error, which roll the plugin's own transaction back (`ABORT`). No DOM.

import { classify } from "../sql/classify.js";

/**
 * @typedef {import("./common.js").RunResult} RunResult
 * @typedef {import("./common.js").StatementOutcome} StatementOutcome
 * @typedef {import("./common.js").DbError} DbError
 * @typedef {import("./pg-script.js").Plan} Plan
 * @typedef {import("./pg-script.js").Job} Job
 * @typedef {import("../sql/split.js").Statement} Statement
 * @typedef {{ sessionId: string, transaction: import("@endue-ai/bridge").DbTransaction }} Entry
 * @typedef {{ id: string, own: boolean, at: number | undefined, page: number }} Open
 *   `own`: in the plugin's own transaction; `at` the rows before the server's position, when known.
 * @typedef {{ id: string, from: number, count: number } | { id: string, all: true }} Ask
 * @typedef {{ rows: (string | null)[][], done: boolean, total?: number } | { error: DbError }} Got
 */

export const CURSOR = "endue_desk_rows";
export const PREFIX = `DECLARE ${CURSOR} SCROLL CURSOR FOR\n`;
/** The plugin's own transaction around a cursor, in words a person's script does not use, so a
 * reader of the session's statements tells them apart: END commits and ABORT rolls back. */
export const BEGIN = "START TRANSACTION";
export const COMMIT = "END";
export const ROLLBACK = "ABORT";
/** A cursor's page: the max-rows setting, 10,000 rows at most. */
export const MAX_PAGE = 10_000;
export const pageOf = (/** @type {number} */ maxRows) => Math.min(MAX_PAGE, Math.max(1, maxRows));
const FIRST = new Set(["SELECT", "WITH", "VALUES", "TABLE"]);
const OWN = new Set(["FOR", "INTO"]);

/** Whether a statement reads through a cursor: one read, no FOR UPDATE, no INTO. */
export function cursorable(/** @type {Statement} */ statement) {
  let depth = 0;
  /** @type {string[]} */
  const words = [];
  for (const token of statement.tokens ?? []) {
    if (token.type === "op" && token.text === "(") depth++;
    else if (token.type === "op" && token.text === ")") depth--;
    else if (token.type === "word" && depth === 0) words.push(token.text.toUpperCase());
  }
  if (!FIRST.has(words[0] ?? "") || words.some((w) => OWN.has(w))) return false;
  if (words[0] === "WITH" && !words.includes("SELECT")) return false;
  const kind = classify(statement, "postgresql");
  return kind.kind === "read" && !kind.opensWrite;
}

/** A statement of the plugin's own, as pg-script.js runs one. @returns {Statement} */
export const own = (/** @type {string} */ text) => ({
  text,
  start: 0,
  end: text.length,
  line: 1,
  column: 1,
  tokens: [],
});

/**
 * @param {{ script(job: Job, plan: Plan, before?: import("@endue-ai/bridge").DbTransaction): Promise<RunResult> }} deps
 */
export function createCursors({ script }) {
  /** @type {Map<string, Open>} */
  const open = new Map();
  let made = 0;

  /** Run the plugin's statements on the job's session; the outcomes and the run's notices. */
  const steps = async (
    /** @type {Job} */ job,
    /** @type {Plan} */ plan,
    /** @type {string[]} */ sqls,
  ) => script(job, { ...plan, mode: "run", statements: sqls.map(own) });

  /** End the session's cursor, if it has one, before another run; the entry's transaction follows. */
  const end = async (
    /** @type {Job} */ job,
    /** @type {Plan} */ plan,
    /** @type {Entry} */ entry,
  ) => {
    const held = open.get(entry.sessionId);
    if (!held) return [];
    open.delete(entry.sessionId);
    if (job.transaction === "failed" && !held.own) return [];
    const done = await steps(job, plan, [held.own ? COMMIT : `CLOSE ${CURSOR}`]);
    entry.transaction = job.transaction ?? entry.transaction;
    return done.notices;
  };

  /** A failure during a fetch ends the cursor: the plugin's own transaction rolls back. */
  const lost = async (
    /** @type {Job} */ job,
    /** @type {Plan} */ plan,
    /** @type {Open} */ held,
    /** @type {string} */ sessionId,
  ) => {
    open.delete(sessionId);
    if (held.own) await steps({ ...job, cancelled: false }, plan, [ROLLBACK]);
    if (held.own) job.transaction = "idle";
  };

  return {
    /** Whether a run reads through a cursor: a console's single read in a run, not an agent's. */
    wanted: (/** @type {Plan} */ plan, /** @type {Entry} */ entry) =>
      plan.session?.kind === "console" &&
      plan.mode === "run" &&
      !plan.agent &&
      plan.statements.length === 1 &&
      entry.transaction !== "failed" &&
      cursorable(/** @type {Statement} */ (plan.statements[0])),
    end,
    /** Whether the session's open transaction is only the plugin's own, for its cursor. */
    hidden: (/** @type {string} */ sessionId) => open.get(sessionId)?.own === true,
    /** The session ended: its cursor went with it. */
    closed: (/** @type {string} */ sessionId) => open.delete(sessionId),

    /**
     * Declare the plan's read and fetch its first page; a read that fits one page ends its cursor.
     * @param {Job} job @param {Plan} plan @param {Entry} entry @returns {Promise<RunResult>}
     */
    async declare(job, plan, entry) {
      const statement = /** @type {Statement} */ (plan.statements[0]);
      const mine = entry.transaction === "idle";
      const page = pageOf(plan.maxRows);
      const sqls = [
        ...(mine ? [BEGIN] : []),
        `${PREFIX}${statement.text}`,
        `FETCH FORWARD ${page} FROM ${CURSOR}`,
      ];
      const ran = await script(job, {
        ...plan,
        maxRows: page,
        statements: sqls.map((text, i) =>
          i === sqls.length - 2 ? { ...statement, text } : own(text),
        ),
      });
      const base = mine ? 1 : 0;
      const declared = ran.statements[base];
      const fetched = ran.statements[base + 1];
      const failure = declared?.error ?? fetched?.error ?? ran.statements[0]?.error;
      /** @type {StatementOutcome} */
      const outcome = {
        ...(fetched?.ran ? fetched : (declared ?? fetched ?? ran.statements[0])),
        index: 0,
        ran: true,
        notices: [...(declared?.notices ?? []), ...(fetched?.notices ?? [])],
      };
      const result = { ...ran, statements: [outcome] };
      if (failure) {
        const at = failure.position;
        outcome.error =
          at !== undefined && at >= PREFIX.length
            ? { ...failure, position: at - PREFIX.length }
            : failure;
        if (failure.position !== undefined && at !== undefined && at < PREFIX.length)
          delete outcome.error.position;
        outcome.sets = [];
        if (mine) await steps({ ...job, cancelled: false }, plan, [ROLLBACK]);
        if (mine) job.transaction = "idle";
        return result;
      }
      const set = outcome.sets[0];
      const rows = set?.rows.length ?? 0;
      if (!set || rows < page) {
        if (set) outcome.sets = [{ ...set, truncated: false }];
        if (mine) result.notices.push(...(await steps(job, plan, [COMMIT])).notices);
        else await steps(job, plan, [`CLOSE ${CURSOR}`]);
        return result;
      }
      const id = `${entry.sessionId}#${++made}`;
      open.set(entry.sessionId, { id, own: mine, at: rows, page });
      outcome.sets = [
        { ...set, truncated: true, window: { id, first: 0, known: rows, done: false, page } },
      ];
      if (mine) job.transaction = "idle";
      return result;
    },

    /**
     * Rows of the session's cursor: `count` from row `from`, or every row counted (`all`).
     * @param {Job} job @param {Plan} plan @param {Entry} entry @param {Ask} ask @returns {Promise<Got>}
     */
    async rows(job, plan, entry, ask) {
      const held = open.get(entry.sessionId);
      if (!held || held.id !== ask.id)
        return {
          error: {
            kind: "client",
            message:
              "The rows past those held are gone: the console ran something else, or its session ended.",
          },
        };
      const from = "all" in ask ? undefined : ask.from;
      const sqls =
        "all" in ask
          ? [`MOVE ABSOLUTE 0 IN ${CURSOR}`, `MOVE FORWARD ALL IN ${CURSOR}`]
          : [
              ...(held.at === from ? [] : [`MOVE ABSOLUTE ${from} IN ${CURSOR}`]),
              `FETCH FORWARD ${ask.count} FROM ${CURSOR}`,
            ];
      const ran = await script(job, {
        ...plan,
        mode: "run",
        maxRows: "all" in ask ? 1 : ask.count,
        statements: sqls.map(own),
      });
      const last = ran.statements.at(-1);
      const failure =
        ran.statements.find((s) => s.error)?.error ??
        (job.cancelled ? { kind: "cancelled", message: "Cancelled." } : undefined);
      if (failure || !last?.ran) {
        await lost(job, plan, held, entry.sessionId);
        return {
          error: /** @type {DbError} */ (
            failure ?? { kind: "client", message: "The rows could not be read." }
          ),
        };
      }
      if (held.own) job.transaction = "idle";
      if ("all" in ask) {
        held.at = undefined;
        return { rows: [], done: true, total: last.affected ?? 0 };
      }
      const rows = last.sets[0]?.rows ?? [];
      const done = rows.length < ask.count;
      held.at = done ? undefined : (from ?? 0) + rows.length;
      return { rows, done, ...(done ? { total: (from ?? 0) + rows.length } : {}) };
    },
  };
}
