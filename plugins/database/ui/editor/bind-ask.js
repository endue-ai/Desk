// Asking for a PostgreSQL statement's parameters (PG-21, ADR 0353): the server first says, without
// running anything, the type it infers for each one (a check, engines/pg-describe.js), and the
// prompt names it; an answer that does not fit that type is refused and asked again; the answers
// are kept for the console this session, and the statement goes out with them as bound values
// (bind.js). A statement that does not parse is asked about without types, and its run says why.
// No DOM.

import { bind, isSql, misfit, numbered, sentValue } from "./bind.js";
import { asked, paramsOf } from "./params.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../sql/split.js").Statement} Statement
 * @typedef {import("./bind.js").Bound} Bound
 * @typedef {import("../engines/pg-describe.js").Described} Described
 * @typedef {{
 *   ask(title: string, placeholder: string): Promise<string | undefined>,
 *   cancelled(message: string): Error,
 *   execute(conn: Connection, sql: string, options: import("../execute.js").ExecuteOptions): Promise<import("../execute.js").Execution>,
 *   typed: Map<string, string>,
 * }} Deps
 */

export const PLACEHOLDER = "42, it's, NULL, or =now() sent as SQL";

/** @param {Deps} deps */
export function createBoundAsk(deps) {
  /** What the server says `statement` takes, by key; nothing when it cannot say. */
  const typesOf = async (
    /** @type {Connection} */ conn,
    /** @type {Statement} */ statement,
    /** @type {import("../editor/params.js").Param[]} */ params,
    /** @type {import("../session/keeper.js").Owner | undefined} */ session,
  ) => {
    const probe = numbered(statement.text, params);
    /** @type {Bound} */
    const sent = { ...statement, text: probe.text, keys: probe.keys, shifts: probe.shifts };
    const done = await deps
      .execute(conn, probe.text, {
        mode: "describe",
        statements: [sent],
        catalog: true,
        ...(session ? { session } : {}),
      })
      .catch(() => undefined);
    const outcome = /** @type {{ described?: Described } | undefined} */ (
      done?.result.statements[0]
    );
    /** @type {Map<string, { oid: number, type: string }>} */
    const types = new Map();
    for (const taken of outcome?.described?.params ?? []) types.set(taken.key, taken);
    return types;
  };

  /**
   * The statements with their parameters bound from the person's answers, and the labels of those
   * answered with SQL.
   * @param {Connection} conn
   * @param {Statement[]} statements
   * @param {string} memo The key answers are kept under (a console's id).
   * @param {import("../session/keeper.js").Owner} [session]
   * @returns {Promise<{ statements: Bound[], sql: string[] }>}
   */
  return async (conn, statements, memo, session) => {
    /** @type {Record<string, string>} */
    const values = {};
    /** @type {string[]} */
    const sql = [];
    /** @type {Bound[]} */
    const out = [];
    for (const statement of statements) {
      const params = paramsOf(statement.text, "postgresql");
      if (params.length === 0) {
        out.push(statement);
        continue;
      }
      const types = await typesOf(conn, statement, params, session);
      for (const param of asked(params)) {
        if (values[param.key] !== undefined) continue;
        const type = types.get(param.key);
        const title = `Value for ${param.label}${type ? ` (${type.type})` : ""}`;
        const kept = `${memo}\u0000${param.key}`;
        let why = "";
        let offered = deps.typed.get(kept) ?? PLACEHOLDER;
        for (;;) {
          const answer = await deps.ask(why ? `${title}: ${why}` : title, offered);
          if (answer === undefined) throw deps.cancelled("Not run: a parameter has no value.");
          why = isSql(answer) ? "" : misfit(sentValue(answer), type?.oid ?? 0);
          // Refused: asked again, with what was typed to mend.
          offered = answer;
          if (why) continue;
          deps.typed.set(kept, answer);
          values[param.key] = answer;
          if (isSql(answer)) sql.push(param.label);
          break;
        }
      }
      /** @type {Record<string, number>} */
      const oids = {};
      for (const [key, type] of types) oids[key] = type.oid;
      out.push(bind(statement, params, values, oids));
    }
    return { statements: out, sql };
  };
}
