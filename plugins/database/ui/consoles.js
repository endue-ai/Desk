// The work area's buffers: a SQL console per connection and a page view per table, each a desk
// buffer so Mod+B and the buffer list reach it. A console runs the statement at the caret, the
// selection or the whole script, in one of three modes (run, in one transaction, dry run), explains,
// loads more rows of a single read and cancels. A table view pages through rows under the filter
// and order the person typed. The console's text is kept in the store, a run's statements in the
// history. No DOM: the view gets a model and hands back the editor's text and selection.

import { tableSql } from "./catalog.js";
import { engineOf } from "./engines/index.js";
import { split, statementAt } from "./sql/split.js";
import { show, summaryOf } from "./tabs.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./execute.js").Execution} Execution
 * @typedef {import("./execute.js").Mode} Mode
 * @typedef {import("./tabs.js").Shown} Shown
 * @typedef {{ schema: string, name: string, where: string, order: string, offset: number, count: number | null }} TablePage
 * @typedef {{
 *   id: string, kind: "console" | "table", connection: string, name: string, text: string,
 *   table: TablePage | null, execution: Execution | null, shown: Shown | null, running: boolean,
 *   tab: number, maxRows: number,
 * }} Console
 * @typedef {{
 *   console(model: Console | null, conn: Connection | null): void,
 *   editor(): { text: string, start: number, end: number },
 *   select(start: number, end: number): void,
 *   say(text: string): void,
 * }} ConsoleView
 * @typedef {{
 *   commands: { run(id: string, args?: unknown): Promise<unknown> },
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">,
 *   connection(id: string): Connection | undefined,
 *   execute(conn: Connection, sql: string, options?: import("./execute.js").ExecuteOptions): Promise<Execution>,
 *   settings(): import("./settings.js").Settings,
 *   remember(conn: Connection, execution: Execution): void,
 *   view: ConsoleView,
 *   changed(): void,
 * }} Deps
 */

const TEXT_LIMIT = 60 * 1024;
const MORE_MAX = 100_000;
const textKey = (/** @type {string} */ connection) => `console:${connection}`;

/** @param {Deps} deps */
export function createConsoles(deps) {
  /** @type {Map<string, Console>} */
  const consoles = new Map();
  /** @type {string | null} */
  let current = null;
  let local = 0;
  /** The console text waiting to be kept, and its timer. */
  /** @type {{ connection: string, text: string, timer: ReturnType<typeof setTimeout> } | null} */
  let saving = null;
  const keep = () => {
    if (!saving) return;
    clearTimeout(saving.timer);
    const { connection, text } = saving;
    saving = null;
    void deps.bridge
      .call("store.set", { key: textKey(connection), value: text.slice(0, TEXT_LIMIT) })
      .catch(() => {});
  };

  const render = () => {
    const shown = current ? (consoles.get(current) ?? null) : null;
    deps.view.console(shown, shown ? (deps.connection(shown.connection) ?? null) : null);
    deps.changed();
  };

  const nameOf = (/** @type {Connection} */ conn, /** @type {TablePage | null} */ table) =>
    table
      ? `db: ${conn.name} · ${table.schema ? `${table.schema}.` : ""}${table.name}`
      : `db: ${conn.name}`;

  /** The desk buffer a console is, or a local id when the desk has no buffers. */
  const buffer = async (/** @type {string} */ name) => {
    const id = await deps.commands.run("desk.buffers.open", { name }).catch(() => undefined);
    return typeof id === "string" ? id : `local-${++local}`;
  };

  /**
   * Show the console of a connection, or a table's view, opening its buffer the first time.
   * @param {Connection} conn
   * @param {{ schema: string, name: string } | null} [table]
   * @param {string} [given] A buffer the desk opened already (a visited file).
   */
  const open = async (conn, table = null, given = undefined) => {
    const found = given
      ? undefined
      : [...consoles.values()].find(
          (c) =>
            c.connection === conn.id &&
            (table
              ? c.table?.schema === table.schema && c.table?.name === table.name
              : c.kind === "console"),
        );
    if (found) {
      current = found.id;
      render();
      return found;
    }
    const page = table ? { ...table, where: "", order: "", offset: 0, count: null } : null;
    const text = page ? "" : await loadText(conn.id);
    /** @type {Console} */
    const made = {
      id: given ?? (await buffer(nameOf(conn, page))),
      kind: page ? "table" : "console",
      connection: conn.id,
      name: nameOf(conn, page),
      text,
      table: page,
      execution: null,
      shown: null,
      running: false,
      tab: 0,
      maxRows: deps.settings().maxRows,
    };
    consoles.set(made.id, made);
    current = made.id;
    render();
    if (page) await loadPage(made);
    return made;
  };

  const loadText = async (/** @type {string} */ connection) => {
    const kept = await deps.bridge
      .call("store.get", { key: textKey(connection) })
      .catch(() => ({}));
    return typeof kept.value === "string" ? kept.value : "";
  };

  /** The console on screen, or an Error naming what to do. */
  const active = () => {
    const shown = current ? consoles.get(current) : undefined;
    if (!shown)
      throw new Error("No console is open: pick a connection first (Database: open a console).");
    const conn = deps.connection(shown.connection);
    if (!conn) throw new Error("This console's connection was removed.");
    return { shown, conn };
  };

  /**
   * Run SQL in a console and show what came back.
   * @param {Console} target
   * @param {Connection} conn
   * @param {string} sql
   * @param {{ mode?: Mode, base?: number, statements?: import("./sql/split.js").Statement[], maxRows?: number, history?: boolean }} options
   */
  const execute = async (target, conn, sql, options) => {
    if (target.running) throw new Error("A run is going on in this console: cancel it first.");
    target.running = true;
    deps.view.say("");
    render();
    try {
      const execution = await deps.execute(conn, sql, {
        mode: options.mode ?? "run",
        maxRows: options.maxRows ?? deps.settings().maxRows,
        ...(options.statements ? { statements: options.statements } : {}),
      });
      target.execution = execution;
      target.shown = show(execution, options.base ?? 0);
      target.tab = target.shown.open;
      target.maxRows = options.maxRows ?? deps.settings().maxRows;
      if (options.history !== false) deps.remember(conn, execution);
      return execution;
    } finally {
      target.running = false;
      render();
    }
  };

  /**
   * Run from the editor: the selection when there is one, else the statement at the caret
   * (`scope: "statement"`) or the whole script (`scope: "all"`).
   * @param {"statement" | "all"} scope
   * @param {Mode} [mode]
   */
  const run = async (scope, mode = "run") => {
    const { shown, conn } = active();
    if (shown.kind === "table") return refreshPage(shown, conn);
    const { text, start, end } = deps.view.editor();
    shown.text = text;
    const done =
      start !== end
        ? await execute(shown, conn, text.slice(start, end), { mode, base: start })
        : scope === "all"
          ? await execute(shown, conn, text, { mode })
          : await execute(shown, conn, text, { mode, statements: atCaret(conn, text, start) });
    if (shown.shown?.error) deps.view.select(shown.shown.error.offset, shown.shown.error.offset);
    return summary(done);
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

  /** EXPLAIN the statement at the caret (or the selection). */
  const explain = async () => {
    const { shown, conn } = active();
    if (shown.kind === "table") throw new Error("Explain runs from a console.");
    const { text, start, end } = deps.view.editor();
    const [statement] =
      start !== end
        ? split(text.slice(start, end), engineOf(conn.engine).dialect)
        : atCaret(conn, text, start);
    if (!statement) throw new Error("Nothing to explain.");
    return summary(
      await execute(shown, conn, engineOf(conn.engine).explain(statement.text), { history: false }),
    );
  };

  /** Load four times as many rows of the last single read. */
  const more = async () => {
    const { shown, conn } = active();
    const last = shown.execution;
    const truncated = last?.result.statements.some((s) => s.sets.some((set) => set.truncated));
    if (!last || !truncated || last.statements.length !== 1)
      throw new Error("Nothing more to load.");
    const maxRows = Math.min(MORE_MAX, shown.maxRows * 4);
    if (shown.kind === "table" && shown.table) return refreshPage(shown, conn);
    return summary(
      await execute(shown, conn, last.sql, {
        statements: last.statements,
        maxRows,
        history: false,
      }),
    );
  };

  /** Load a table view's page under its filter and order. */
  const loadPage = async (/** @type {Console} */ target) => {
    const conn = deps.connection(target.connection);
    if (!conn || !target.table) return;
    await refreshPage(target, conn);
  };

  const refreshPage = async (/** @type {Console} */ target, /** @type {Connection} */ conn) => {
    const page = /** @type {TablePage} */ (target.table);
    const limit = deps.settings().maxRows;
    const sql = tableSql(conn, {
      schema: page.schema,
      table: page.name,
      where: page.where,
      order: page.order,
      limit,
      offset: page.offset,
    });
    return summary(await execute(target, conn, sql.page, { maxRows: limit, history: false }));
  };

  /**
   * A table view's filter, order or page: `delta` pages forward or back.
   * @param {{ where?: string, order?: string, delta?: number, count?: boolean }} change
   */
  const page = async (change) => {
    const { shown, conn } = active();
    if (shown.kind !== "table" || !shown.table) throw new Error("Paging is for a table's view.");
    const limit = deps.settings().maxRows;
    const table = shown.table;
    if (change.where !== undefined) table.where = change.where;
    if (change.order !== undefined) table.order = change.order;
    if (change.where !== undefined || change.order !== undefined) {
      table.offset = 0;
      table.count = null;
    }
    if (change.delta) table.offset = Math.max(0, table.offset + change.delta * limit);
    if (change.count) {
      const sql = tableSql(conn, {
        schema: table.schema,
        table: table.name,
        where: table.where,
        order: "",
        limit,
        offset: 0,
      });
      const counted = await deps.execute(conn, sql.count, { catalog: true });
      const value = counted.result.statements[0]?.sets[0]?.rows[0]?.[0];
      const error = counted.result.error ?? counted.result.statements[0]?.error;
      if (error) throw new Error(error.message);
      table.count = value === null || value === undefined ? null : Number(value);
      render();
      return `${table.count} rows`;
    }
    return refreshPage(shown, conn);
  };

  /** The editor's text changed: keep it, a moment later, in the store. */
  const edited = (/** @type {string} */ text) => {
    const target = current ? consoles.get(current) : undefined;
    if (target?.kind !== "console") return;
    target.text = text;
    if (saving && saving.connection !== target.connection) keep();
    if (saving) clearTimeout(saving.timer);
    saving = { connection: target.connection, text, timer: setTimeout(keep, 400) };
  };

  return {
    open,
    run,
    explain,
    more,
    page,
    edited,
    render,
    /** Pick a result tab. */
    tab(/** @type {number} */ index) {
      const target = current ? consoles.get(current) : undefined;
      if (target?.shown && index >= 0 && index < target.shown.tabs.length) target.tab = index;
      render();
    },
    /** The desk shows one of this plugin's buffers. */
    show(/** @type {string} */ id) {
      if (!consoles.has(id)) return false;
      current = id;
      render();
      return true;
    },
    /** The desk closed one of this plugin's buffers. */
    closed(/** @type {string} */ id) {
      if (!consoles.delete(id)) return;
      if (current === id) current = null;
      render();
    },
    /** Close every buffer of a connection (it was removed). */
    async drop(/** @type {string} */ connection) {
      for (const target of [...consoles.values()].filter((c) => c.connection === connection)) {
        consoles.delete(target.id);
        if (current === target.id) current = null;
        await deps.commands.run("desk.buffers.close", { id: target.id }).catch(() => {});
      }
      render();
    },
    /** Rename a connection's buffers after an edit. */
    async renamed(/** @type {Connection} */ conn) {
      for (const target of consoles.values()) {
        if (target.connection !== conn.id) continue;
        target.name = nameOf(conn, target.table);
        await deps.commands
          .run("desk.buffers.update", { id: target.id, name: target.name })
          .catch(() => {});
      }
      render();
    },
    current: () => (current ? (consoles.get(current) ?? null) : null),
    list: () => [...consoles.values()],
  };
}

/** One line about a run, for a command's answer. */
function summary(/** @type {Execution} */ execution) {
  const indexes = execution.statements.map((_, i) => i);
  return indexes.map((i) => summaryOf(execution, i)).join("; ");
}
