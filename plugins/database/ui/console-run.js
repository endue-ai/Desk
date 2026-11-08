// Running from a console's editor: the statement at the caret, the selection or the whole script,
// with its parameters asked for first (`:name`, `?`, `$1`, remembered for the session); EXPLAIN
// as a plan tree (ANALYZE of a write rolls back); Format SQL; more rows of a single read; and a
// console SELECT made pageable when it came back with more rows than it shows. No DOM.

import { formatSql } from "./editor/format.js";
import { asked, fill, paramsOf, valueSql } from "./editor/params.js";
import { engineOf } from "./engines/index.js";
import { explainSql, planOf } from "./explain/plan.js";
import { pagedSql } from "./pages.js";
import { classify } from "./sql/classify.js";
import { split, statementAt } from "./sql/split.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./execute.js").Mode} Mode
 * @typedef {import("./sql/split.js").Statement} Statement
 * @typedef {import("./consoles.js").Console} Console
 * @typedef {{
 *   deps: import("./consoles.js").Deps,
 *   active(): { shown: Console, conn: Connection },
 *   execute(target: Console, conn: Connection, sql: string, options: { mode?: Mode, base?: number, statements?: Statement[], maxRows?: number, history?: boolean }): Promise<string>,
 *   render(): void,
 *   typed: Map<string, string>,
 * }} Inner
 */

const MORE_MAX = 100_000;

/** @param {Inner} inner */
export function createRunning({ deps, active, execute, render, typed }) {
  /** Statements with their parameters filled from the person's answers. */
  const filled = async (/** @type {Connection} */ conn, /** @type {Statement[]} */ statements) => {
    const { dialect } = engineOf(conn.engine);
    /** @type {Record<string, string>} */
    const values = {};
    const out = [];
    for (const statement of statements) {
      const params = paramsOf(statement.text, dialect);
      if (params.length === 0) {
        out.push(statement);
        continue;
      }
      for (const param of asked(params)) {
        if (values[param.key] !== undefined) continue;
        const memo = `${conn.id}\u0000${param.key}`;
        const answer = await deps.ask(
          `Value for ${param.label}`,
          typed.get(memo) ?? "42, it's, NULL or =now()",
        );
        if (answer === undefined) throw deps.cancelled("Not run: a parameter has no value.");
        typed.set(memo, answer);
        values[param.key] = valueSql(dialect, answer);
      }
      const text = fill(statement.text, params, values);
      for (const piece of split(text, dialect))
        out.push({
          ...piece,
          start: statement.start,
          line: statement.line,
          column: statement.column,
        });
    }
    return out;
  };

  /** The statement at the caret, as a list of one. */
  const atCaret = (
    /** @type {Connection} */ conn,
    /** @type {string} */ text,
    /** @type {number} */ caret,
  ) => {
    const statement = statementAt(split(text, engineOf(conn.engine).dialect), caret, text);
    if (!statement) throw new Error("Nothing to run: the editor holds no statement.");
    return [statement];
  };

  /**
   * Run from the editor: the selection when there is one, else the statement at the caret
   * (`scope: "statement"`) or the whole script (`scope: "all"`).
   * @param {"statement" | "all"} scope
   * @param {Mode} [mode]
   */
  const run = async (scope, mode = "run") => {
    const { shown, conn } = active();
    if (shown.kind === "table") return pages.refresh(shown, conn);
    if (shown.kind === "ddl") throw new Error("A DDL view does not run: copy it into a console.");
    const { text, start, end } = deps.view.editor();
    shown.text = text;
    const { dialect } = engineOf(conn.engine);
    const selected = start !== end;
    const sql = selected ? text.slice(start, end) : text;
    const picked = selected || scope === "all" ? split(sql, dialect) : atCaret(conn, text, start);
    if (picked.length === 0) throw new Error("Nothing to run: the editor holds no statement.");
    const statements = await filled(conn, picked);
    const said = await execute(shown, conn, sql, { mode, base: selected ? start : 0, statements });
    const only = statements.length === 1 ? statements[0] : undefined;
    const truncated = shown.execution?.result.statements[0]?.sets.some((s) => s.truncated);
    shown.page =
      only && mode === "run" && truncated && pagedSql(only, dialect, 1, 0)
        ? { statement: only, offset: 0 }
        : null;
    if (shown.shown?.error) deps.view.select(shown.shown.error.offset, shown.shown.error.offset);
    render();
    return said;
  };

  /** EXPLAIN (or EXPLAIN ANALYZE) the statement at the caret or the selection, as a plan tree. */
  const explain = async (/** @type {boolean} */ analyze = false) => {
    const { shown, conn } = active();
    if (shown.kind !== "console") throw new Error("Explain runs from a console.");
    const { text, start, end } = deps.view.editor();
    const { dialect } = engineOf(conn.engine);
    const [picked] =
      start !== end ? split(text.slice(start, end), dialect) : atCaret(conn, text, start);
    if (!picked) throw new Error("Nothing to explain.");
    const [statement] = await filled(conn, [picked]);
    if (!statement) throw new Error("Nothing to explain.");
    const sql = explainSql(dialect, await deps.flavor(conn), statement.text, analyze);
    // ANALYZE runs the statement: a write is rolled back at the end.
    const writes = analyze && classify(statement, dialect).kind !== "read";
    const said = await execute(shown, conn, sql, {
      history: false,
      mode: writes ? "dry-run" : "run",
    });
    const set = shown.shown?.tabs.find((t) => t.kind === "rows")?.set;
    const plan = set ? planOf(set) : undefined;
    if (plan && shown.shown) {
      shown.shown.tabs.unshift({
        label: analyze ? "Plan (analyzed)" : "Plan",
        kind: "plan",
        plan,
        statement: 0,
      });
      shown.tab = 0;
      shown.page = null;
      render();
    }
    return said;
  };

  /** Format the selection, or the whole script. */
  const format = () => {
    const { shown, conn } = active();
    if (shown.kind !== "console") throw new Error("Format works in a console.");
    const { text, start, end } = deps.view.editor();
    const [from, to] = start !== end ? [start, end] : [0, text.length];
    const formatted = formatSql(text.slice(from, to), engineOf(conn.engine).dialect);
    deps.view.replace(from, to, formatted);
    return "Formatted.";
  };

  /** Load four times as many rows of the last single read. */
  const more = async () => {
    const { shown, conn } = active();
    const last = shown.execution;
    const truncated = last?.result.statements.some((s) => s.sets.some((set) => set.truncated));
    if (!last || !truncated || last.statements.length !== 1)
      throw new Error("Nothing more to load.");
    if (shown.kind === "table" && shown.table) return pages.refresh(shown, conn);
    const maxRows = Math.min(MORE_MAX, shown.maxRows * 4);
    return execute(shown, conn, last.sql, { statements: last.statements, maxRows, history: false });
  };

  return { run, explain, format, more };
}
