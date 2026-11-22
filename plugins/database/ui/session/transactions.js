// A console's transaction across runs (PG-20). In Manual mode the first statement of a plain run on
// a session outside a transaction goes after the BEGIN the console's choice says (its isolation
// level, READ ONLY), sent in the same run, after the guards and the question, and left out of the
// run's result; a run that starts with the person's own transaction control is left alone. Every
// run of a console in a transaction, in either mode, is followed: when the transaction began, the
// statements it holds, when its last run ended and its savepoints, which the header model carries.
// No DOM.

import { AUTO, beginSql, controlOf, nextLabel } from "./transaction-words.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../engines/common.js").RunResult} RunResult
 * @typedef {import("../engines/pg-script.js").Plan} Plan
 * @typedef {import("./words.js").SessionModel} SessionModel
 * @typedef {import("./transaction-words.js").Chosen} Chosen
 * @typedef {import("./transaction-words.js").TransactionModel} TransactionModel
 * @typedef {{ since: number, at: number, statements: number, savepoints: string[] }} Held
 * @typedef {{
 *   chosen(owner: string): Chosen | undefined,
 *   held(owner: string): boolean,
 *   flagMs(): number,
 *   now(): number,
 * }} Deps
 *   `chosen` is the console's choice (undefined: the owner is not a console), `held` whether its
 *   session is in a transaction, open or failed, now; `flagMs` the idle time a transaction is
 *   flagged after (0: never).
 */

/** A statement of the plugin's own, as the split gives one. */
const statementOf = (/** @type {string} */ text) => ({
  text,
  start: 0,
  end: text.length,
  line: 1,
  column: 1,
  tokens: [],
});

/** A run's result without its first statement, the plugin's BEGIN: its notices and error are the run's. */
function withoutBegin(/** @type {RunResult} */ result) {
  const [begin, ...rest] = result.statements;
  const error =
    result.error ??
    (begin?.error ? { ...begin.error, message: `BEGIN: ${begin.error.message}` } : undefined);
  return {
    ...result,
    statements: rest.map((outcome) => ({ ...outcome, index: outcome.index - 1 })),
    notices: [...(begin?.notices ?? []), ...result.notices],
    ...(error ? { error } : {}),
  };
}

/** @param {Deps} deps */
export function createTransactions(deps) {
  /** The open transactions, by owner. @type {Map<string, Held>} */
  const open = new Map();

  /** What a run did to its owner's transaction: began, ended, held more statements, savepoints. */
  const follow = (
    /** @type {string} */ owner,
    /** @type {Plan["statements"]} */ statements,
    /** @type {RunResult} */ result,
    /** @type {number} */ started,
  ) => {
    if (!deps.held(owner)) {
      open.delete(owner);
      return;
    }
    const held = open.get(owner) ?? { since: started, at: 0, statements: 0, savepoints: [] };
    open.set(owner, held);
    for (const outcome of result.statements) {
      if (!outcome.ran) continue;
      const { does, name } = controlOf(statements[outcome.index]?.text ?? "");
      if (does === "begin" || does === "end") {
        Object.assign(held, { since: started, statements: 0, savepoints: [] });
        continue;
      }
      if (does === "none") {
        held.statements++;
        continue;
      }
      if (outcome.error || !name) continue;
      const at = held.savepoints.lastIndexOf(name);
      if (does === "savepoint") held.savepoints.push(name);
      else if (at >= 0) held.savepoints.splice(does === "release" ? at : at + 1);
    }
    held.at = deps.now();
  };

  return {
    /**
     * Run `plan` through `go`, beginning Manual mode's transaction first when one is due.
     * @param {Connection} conn @param {Plan} plan
     * @param {(conn: Connection, plan: Plan) => Promise<RunResult>} go
     * @returns {Promise<RunResult>}
     */
    async run(conn, plan, go) {
      const owner = plan.session?.kind === "console" ? plan.session.owner : undefined;
      const chosen = owner ? deps.chosen(owner) : undefined;
      // A check runs nothing: it begins nothing and is none of the transaction's statements (PG-21).
      if (plan.mode === "describe") return go(conn, plan);
      if (!owner || !chosen) return go(conn, plan);
      const started = deps.now();
      const [first] = plan.statements;
      const begins =
        chosen.mode === "manual" &&
        plan.mode === "run" &&
        first !== undefined &&
        controlOf(first.text).does === "none" &&
        !deps.held(owner);
      const result = begins
        ? withoutBegin(
            await go(conn, {
              ...plan,
              statements: [statementOf(beginSql(chosen)), ...plan.statements],
            }),
          )
        : await go(conn, plan);
      follow(owner, plan.statements, result, started);
      return result;
    },
    /**
     * The header's model of an owner's session: a console's mode and next transaction's options,
     * and its open transaction while there is one.
     * @param {string} owner @param {SessionModel} base
     * @returns {TransactionModel}
     */
    model(owner, base) {
      const chosen = deps.chosen(owner);
      if (!chosen) return base;
      const holds = base.state === "open" || base.state === "failed" || base.state === "running";
      if (!holds) open.delete(owner);
      const held = holds ? open.get(owner) : undefined;
      return {
        ...base,
        mode: chosen.mode,
        next: nextLabel(chosen),
        flagMs: deps.flagMs(),
        savepoints: held ? [...held.savepoints] : [],
        ...(held ? { since: held.since, at: held.at, statements: held.statements } : {}),
      };
    },
  };
}

/** A console's choice, as the console keeps it (`transactions`), else Auto. */
export const chosenOf = (/** @type {{ transactions?: Chosen }} */ target) =>
  target.transactions ?? AUTO;
