// The page's side of the problems check (ADR 0294): one check in flight per console, so a stale one
// is never sent: while one runs, the newest request waits in place of the others and every caller
// that waited gets its answer. The worker is never stopped for it, so the parser's other callers
// keep theirs. It also keeps what the server said of each statement a console ran (by the
// statement's text), which the check takes instead of its own until the text changes.

/**
 * @typedef {import("../sql/parse/model.js").SchemaModel} SchemaModel
 * @typedef {import("./check.js").Answer} Answer
 * @typedef {import("./check.js").CheckResult} CheckResult
 * @typedef {import("../execute.js").Execution} Execution
 * @typedef {{ model: SchemaModel | null, searchPath: string[], user: string, syntax: boolean,
 *   names: boolean, warnings?: boolean, off?: string[] }} Context
 * @typedef {{ check(sql: string, model: SchemaModel | null, options: Record<string, unknown>): Promise<CheckResult> }} Checking
 * @typedef {{ sql: string, context: Context, callers: Array<(result: CheckResult | null) => void> }} Waiting
 */

/** Statements whose answers a console keeps; the oldest goes first. */
const KEPT_ANSWERS = 500;

/** @param {() => Checking | undefined} parser */
export function createChecks(parser) {
  /** @type {Map<string, { running: boolean, waiting: Waiting | null }>} */
  const docs = new Map();
  /** @type {Map<string, { at: number, answers: Map<string, Answer> }>} */
  const said = new Map();

  const answersOf = (/** @type {string} */ doc) => [...(said.get(doc)?.answers ?? new Map())];

  /** Send one request; when it settles, the one that waited meanwhile goes. */
  const send = (/** @type {string} */ doc, /** @type {Waiting} */ job) => {
    const slot = docs.get(doc) ?? { running: false, waiting: null };
    docs.set(doc, slot);
    slot.running = true;
    const { model, ...options } = job.context;
    const asked = parser()?.check(job.sql, model, { doc, ...options, answers: answersOf(doc) });
    const done = asked ? asked.catch(() => null) : Promise.resolve(null);
    done.then((result) => {
      for (const caller of job.callers) caller(result);
      slot.running = false;
      const waiting = slot.waiting;
      slot.waiting = null;
      if (waiting) send(doc, waiting);
    });
  };

  return {
    /**
     * The problems of a console's text under its context; null when the parser could not answer.
     * @param {string} doc the console
     * @param {string} sql
     * @param {Context} context
     * @returns {Promise<CheckResult | null>}
     */
    check(doc, sql, context) {
      return new Promise((resolve) => {
        const slot = docs.get(doc);
        if (!slot?.running) return send(doc, { sql, context, callers: [resolve] });
        const callers = [...(slot.waiting?.callers ?? []), resolve];
        slot.waiting = { sql, context, callers };
      });
    },
    /**
     * What the server said of the statements of a run; true when it is new.
     * @param {string} doc
     * @param {Execution} execution
     */
    remember(doc, execution) {
      const kept = said.get(doc) ?? { at: -1, answers: new Map() };
      if (kept.at === execution.at) return false;
      kept.at = execution.at;
      said.set(doc, kept);
      for (const outcome of execution.result?.statements ?? []) {
        const text = execution.statements[outcome.index]?.text;
        if (text === undefined || !outcome.ran) continue;
        const error = outcome.error;
        if (error && error.kind !== "sql") continue;
        kept.answers.delete(text);
        kept.answers.set(
          text,
          error
            ? {
                message: error.message,
                ...(error.position !== undefined ? { at: error.position } : {}),
              }
            : { ok: true },
        );
      }
      while (kept.answers.size > KEPT_ANSWERS)
        kept.answers.delete(/** @type {string} */ (kept.answers.keys().next().value));
      return true;
    },
    /** The answers a console's check takes, by statement text. */
    answers: answersOf,
  };
}
