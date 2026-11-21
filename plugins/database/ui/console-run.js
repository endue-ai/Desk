// Running from a console's editor: the statement at the caret, the selection or the whole script,
// with its parameters asked for first (`:name`, `?`, `$1`, remembered for the console); EXPLAIN
// as a plan tree with PostgreSQL's options the connection keeps (ANALYZE of a write rolls back),
// each plan kept for comparing; Format SQL (PostgreSQL laid out again from its parse tree in the
// parse worker, by the style in the settings, ADR 0292; MySQL and SQLite token by token); more
// rows of a single read; and a console SELECT made pageable when it came back with more rows than
// it shows. No DOM.

import { formatSql } from "./editor/format.js";
import { asked, fill, paramsOf, valueSql } from "./editor/params.js";
import { engineOf } from "./engines/index.js";
import { readOptions } from "./explain/options.js";
import { explainSql, planOf } from "./explain/plan.js";
import { createVersions } from "./explain/version.js";
import { pagedSql } from "./pages.js";
import { formatStyle } from "./settings.js";
import { classify } from "./sql/classify.js";
import { sqlParser } from "./sql/parse/client.js";
import { split, statementAt } from "./sql/split.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./execute.js").Mode} Mode
 * @typedef {import("./sql/split.js").Statement} Statement
 * @typedef {import("./consoles.js").Console} Console
 * @typedef {import("./sql/layout/layout.js").Laid} Laid
 * @typedef {{ id: string, at: number, label: string, sql: string, plan: import("./explain/node.js").PlanNode }} Kept
 *   A plan a console explained, kept for comparing (the last KEEP of each console, this session).
 * @typedef {{
 *   deps: import("./consoles.js").Deps,
 *   active(): { shown: Console, conn: Connection },
 *   execute(target: Console, conn: Connection, sql: string, options: { mode?: Mode, base?: number, statements?: Statement[], maxRows?: number, history?: boolean }): Promise<string>,
 *   render(): void,
 *   typed: Map<string, string>,
 * }} Inner
 */

const MORE_MAX = 100_000;
const KEEP = 8;

/** What Format SQL says: done, and every statement it left as written and why. */
export function formatNote(/** @type {Laid} */ laid) {
  /** @type {string[]} */
  const notes = [];
  const [first] = laid.left;
  if (first) {
    const which =
      laid.left.length === 1
        ? "a statement that does not parse is"
        : `${laid.left.length} statements that do not parse are`;
    notes.push(`${which} left as written (line ${first.line}: ${first.message})`);
  }
  if (laid.kept > 0)
    notes.push(
      `${laid.kept === 1 ? "a BEGIN ATOMIC body is" : `${laid.kept} BEGIN ATOMIC bodies are`} left as written`,
    );
  if (laid.refused > 0)
    notes.push(
      `${laid.refused === 1 ? "a statement is" : `${laid.refused} statements are`} left as written: laid out, it would not read the same`,
    );
  if (notes.length === 0) return laid.laid > 0 ? "Formatted." : "Nothing to format.";
  return `${laid.laid > 0 ? "Formatted" : "Nothing formatted"}; ${notes.join("; ")}.`;
}

/**
 * Format SQL over a whole text by an engine's format, as Save does with format on save: the range
 * that changes and its new text, what the status line says, and how many statements it left.
 * @param {string} text
 * @param {Connection["engine"]} engine
 * @param {import("./settings.js").Settings} settings
 * @returns {Promise<{ from: number, to: number, text: string, note: string, left: number }>}
 */
export async function formatText(text, engine, settings) {
  const { dialect } = engineOf(engine);
  if (dialect !== "postgresql") {
    const laid = formatSql(text, dialect);
    return { from: 0, to: text.length, text: laid, note: "Formatted.", left: 0 };
  }
  const parser = sqlParser();
  if (!parser) throw new Error("The SQL parser has not started.");
  const laid = await parser.layout(text, formatStyle(settings));
  const left = laid.left.length + laid.kept + laid.refused;
  return { from: laid.from, to: laid.to, text: laid.text, note: formatNote(laid), left };
}

/** @param {Inner} inner */
export function createRunning({ deps, active, execute, render, typed }) {
  const serverVersion = createVersions(deps.execute);
  let explains = 0;

  /** Statements with their parameters filled from the person's answers, kept per console. */
  const filled = async (
    /** @type {Connection} */ conn,
    /** @type {Statement[]} */ statements,
    /** @type {Console} */ owner,
  ) => {
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
        const memo = `${owner.consoleId ?? conn.id}\u0000${param.key}`;
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
    const statements = await filled(conn, picked, shown);
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

  /**
   * EXPLAIN (or EXPLAIN ANALYZE) the statement at the caret or the selection, as a plan tree; on
   * PostgreSQL with the options `on` names, else those the connection keeps (explain/options.js).
   * GENERIC_PLAN leaves `$1` as it is; ANALYZE of a write runs as a dry run, rolled back.
   * @param {boolean} [analyze]
   * @param {string[]} [on]
   */
  const explain = async (analyze = false, on = undefined) => {
    const { shown, conn } = active();
    if (shown.kind !== "console") throw new Error("Explain runs from a console.");
    const { text, start, end } = deps.view.editor();
    const { dialect } = engineOf(conn.engine);
    const [picked] =
      start !== end ? split(text.slice(start, end), dialect) : atCaret(conn, text, start);
    if (!picked) throw new Error("Nothing to explain.");
    const pg = dialect === "postgresql";
    const options = pg ? (on ?? (await readOptions(deps.bridge, conn.id))) : [];
    const generic = pg && !analyze && options.includes("GENERIC_PLAN");
    const [statement] = generic ? [picked] : await filled(conn, [picked], shown);
    if (!statement) throw new Error("Nothing to explain.");
    const chosen = pg ? { on: options, version: await serverVersion(conn) } : undefined;
    const sql = explainSql(dialect, await deps.flavor(conn), statement.text, analyze, chosen);
    const view = shown.shown?.tabs.find((t) => t.kind === "plan")?.view ?? "tree";
    // ANALYZE runs the statement: a write is rolled back at the end.
    const writes = analyze && classify(statement, dialect).kind !== "read";
    const said = await execute(shown, conn, sql, {
      history: false,
      mode: writes ? "dry-run" : "run",
    });
    const set = shown.shown?.tabs.find((t) => t.kind === "rows")?.set;
    const plan = set ? await (deps.readPlan ? deps.readPlan(set) : planOf(set)) : undefined;
    if (plan && shown.shown) {
      const label = analyze ? "Plan (analyzed)" : "Plan";
      shown.shown.tabs.unshift({ label, kind: "plan", plan, statement: 0, view });
      shown.tab = 0;
      shown.page = null;
      /** @type {Kept} */
      const kept = {
        id: `${shown.id}#${++explains}`,
        at: Date.now(),
        label,
        sql: statement.text,
        plan,
      };
      shown.explained = [.../** @type {Kept[]} */ (shown.explained ?? []), kept].slice(-KEEP);
      render();
    }
    return said;
  };

  /**
   * Format SQL: the selection, else the statement at the caret (`statement`) or the whole script.
   * @param {"all" | "statement"} [scope]
   */
  const format = async (scope = "all") => {
    const { shown, conn } = active();
    if (shown.kind !== "console") throw new Error("Format works in a console.");
    const { text, start, end } = deps.view.editor();
    const { dialect } = engineOf(conn.engine);
    let [from, to] = start !== end ? [start, end] : [0, text.length];
    if (dialect !== "postgresql") {
      if (scope === "statement" && start === end) {
        const at = statementAt(split(text, dialect), start, text);
        if (!at) return "Nothing to format.";
        [from, to] = [at.start, at.end];
      }
      deps.view.replace(from, to, formatSql(text.slice(from, to), dialect));
      return "Formatted.";
    }
    const parser = sqlParser();
    if (!parser) throw new Error("The SQL parser has not started.");
    const style = formatStyle(deps.settings());
    const options = scope === "statement" && start === end ? { at: start } : {};
    const laid = await parser.layout(text.slice(from, to), style, options);
    if (deps.view.editor().text !== text)
      throw new Error("The console changed while it was formatted. Format it again.");
    const before = text.slice(from + laid.from, from + laid.to);
    if (laid.text !== before) deps.view.replace(from + laid.from, from + laid.to, laid.text);
    return formatNote(laid);
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

  return { run, explain, format, more, serverVersion };
}
