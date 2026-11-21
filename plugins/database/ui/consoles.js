// The work area's buffers: a SQL console per connection, a page view per table, a DDL view per
// object and the features' panels (panels.js), each a desk buffer (buffers.js) so Mod+B and the
// buffer list reach it. A console runs the statement at the caret, the selection or the whole
// script (asking for its parameters first), in one of three modes (run, in one transaction, dry
// run), explains it as a plan tree, formats it, and pages or loads more rows of a single read.
// Changes in the grid wait as pending changes (edits.js); a new run asks before it drops them. The
// console's text is kept in the store (console-text.js), a run's statements in the history. No DOM:
// the view gets a model and hands back the editor's text and selection.

import { createBuffers } from "./buffers.js";
import { createRunning } from "./console-run.js";
import { createTexts } from "./console-text.js";
import { createEdits } from "./edits.js";
import { createPages } from "./pages.js";
import { createPanels } from "./panels.js";
import { show, summaryOf } from "./tabs.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./execute.js").Execution} Execution
 * @typedef {import("./execute.js").Mode} Mode
 * @typedef {import("./sql/split.js").Statement} Statement
 * @typedef {import("./tabs.js").Shown} Shown
 * @typedef {{ schema: string, name: string, where: string, order: string, offset: number, count: number | null }} TablePage
 * @typedef {{
 *   id: string, kind: string, connection: string, name: string, text: string,
 *   table: TablePage | null, execution: Execution | null, shown: Shown | null, running: boolean,
 *   tab: number, maxRows: number, edit: import("./edits.js").EditState | null,
 *   page: { statement: Statement, offset: number } | null,
 *   [panel: string]: any,
 * }} Console
 *   `kind` is "console", "table", "ddl" or a feature's panel type, whose state sits under that
 *   type's name (`diagram` for the ER diagram). `page` is set when the console's last run was one
 *   SELECT that can be paged.
 * @typedef {{
 *   console(model: Console | null, conn: Connection | null): void,
 *   closed?(id: string): void,
 *   editor(): { text: string, start: number, end: number },
 *   select(start: number, end: number): void,
 *   replace(start: number, end: number, text: string): void,
 *   say(text: string): void,
 * }} ConsoleView
 * @typedef {{
 *   commands: { run(id: string, args?: unknown): Promise<unknown> },
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">,
 *   connection(id: string): Connection | undefined,
 *   execute(conn: Connection, sql: string, options?: import("./execute.js").ExecuteOptions): Promise<Execution>,
 *   catalog: Pick<ReturnType<typeof import("./catalog.js").createCatalog>, "columns">,
 *   settings(): import("./settings.js").Settings,
 *   remember(conn: Connection, execution: Execution): void,
 *   confirm(title: string, reasons: string[]): Promise<boolean>,
 *   ask(title: string, placeholder: string): Promise<string | undefined>,
 *   flavor(conn: Connection): Promise<string>,
 *   cancelled(message: string): Error,
 *   view: ConsoleView,
 *   changed(): void,
 *   panels?: Record<string, Pick<import("./feature-host.js").Panel, "keep">>,
 *   readPlan?(set: import("./engines/common.js").ResultSet): Promise<import("./explain/node.js").PlanNode | undefined>,
 * }} Deps
 *   `panels` are the features' panel types (feature-host.js); `readPlan` reads a big plan in the
 *   plan worker (explain/reader.js), and plans are read in place without it.
 */

/** @param {Deps} deps */
export function createConsoles(deps) {
  const buffers = createBuffers(deps);
  const panels = createPanels(buffers, deps);
  const texts = createTexts(deps);
  const { render } = buffers;
  /** The values typed for parameters this session, by connection and name. */
  /** @type {Map<string, string>} */
  const typed = new Map();

  const nameOf = (/** @type {Connection} */ conn, /** @type {TablePage | null} */ table) =>
    table
      ? `db: ${conn.name} · ${table.schema ? `${table.schema}.` : ""}${table.name}`
      : `db: ${conn.name}`;

  /**
   * Show the console of a connection, or a table's view, opening its buffer the first time.
   * @param {Connection} conn
   * @param {{ schema: string, name: string } | null} [table]
   * @param {string} [given] A buffer the desk opened already (a visited file).
   */
  const open = async (conn, table = null, given = undefined) => {
    const found = given
      ? undefined
      : buffers.find(
          (c) =>
            c.connection === conn.id &&
            (table
              ? c.kind === "table" &&
                c.table?.schema === table.schema &&
                c.table?.name === table.name
              : c.kind === "console"),
        );
    if (found) return buffers.show(found);
    const page = table ? { ...table, where: "", order: "", offset: 0, count: null } : null;
    const text = page ? "" : await texts.load(conn.id);
    const name = nameOf(conn, page);
    const target = buffers.show(
      buffers.made({
        id: given ?? (await buffers.open(name)),
        kind: page ? "table" : "console",
        connection: conn.id,
        name,
        text,
        table: page,
      }),
    );
    if (page) await pages.refresh(target, conn);
    return target;
  };

  /** A read-only text buffer (an object's DDL), opened again with the text when it is there. */
  const openText = async (
    /** @type {Connection} */ conn,
    /** @type {string} */ title,
    /** @type {string} */ text,
  ) => {
    const name = `ddl: ${conn.name} · ${title}`;
    const found = buffers.find((c) => c.kind === "ddl" && c.name === name);
    if (found) {
      found.text = text;
      return buffers.show(found);
    }
    const id = await buffers.open(name);
    return buffers.show(buffers.made({ id, kind: "ddl", connection: conn.id, name, text }));
  };

  /** The console on screen, or an Error naming what to do. */
  const active = () => {
    const shown = buffers.current();
    if (!shown)
      throw new Error("No console is open: pick a connection first (Database: open a console).");
    const conn = deps.connection(shown.connection);
    if (!conn) throw new Error("This console's connection was removed.");
    return { shown, conn };
  };

  /** Before a run replaces a result with pending changes, ask whether to drop them. */
  const discard = async (/** @type {Console} */ target) => {
    if (!edits.pending(target)) return;
    const count = target.edit?.count ?? 0;
    const ok = await deps.confirm(`Drop ${count} pending change${count === 1 ? "" : "s"}?`, [
      "The new run replaces the rows they were made on. Submit them first to keep them.",
    ]);
    if (!ok) throw deps.cancelled("Not run: the pending changes are kept.");
  };

  /**
   * Run SQL in a console and show what came back; answers a line about it.
   * @param {Console} target
   * @param {Connection} conn
   * @param {string} sql
   * @param {{ mode?: Mode, base?: number, statements?: Statement[], maxRows?: number, history?: boolean }} options
   */
  const execute = async (target, conn, sql, options) => {
    if (target.running) throw new Error("A run is going on in this console: cancel it first.");
    await discard(target);
    target.running = true;
    deps.view.say("");
    render();
    try {
      const maxRows = options.maxRows ?? deps.settings().maxRows;
      const execution = await deps.execute(conn, sql, {
        mode: options.mode ?? "run",
        maxRows,
        ...(options.statements ? { statements: options.statements } : {}),
      });
      target.execution = execution;
      target.shown = show(execution, options.base ?? 0);
      target.tab = target.shown.open;
      target.maxRows = maxRows;
      target.edit = null;
      if (options.history !== false) deps.remember(conn, execution);
      return summary(execution);
    } finally {
      target.running = false;
      render();
    }
  };

  const pages = createPages({
    settings: deps.settings,
    run: (target, conn, sql, options) => execute(target, conn, sql, options),
    execute: deps.execute,
    render,
  });
  const edits = createEdits({
    catalog: deps.catalog,
    execute: deps.execute,
    render,
    reload: (target, conn) =>
      target.kind === "table"
        ? pages.refresh(target, conn)
        : target.execution
          ? execute(target, conn, target.execution.sql, {
              statements: target.execution.statements,
              history: false,
            })
          : Promise.resolve(),
  });

  const { run, explain, format, more, serverVersion } = createRunning({
    deps,
    active,
    execute,
    render,
    typed,
  });

  /** The editor's text changed: keep it, a moment later, in the store. */
  const edited = (/** @type {string} */ text) => {
    const target = buffers.current();
    if (target?.kind !== "console") return;
    target.text = text;
    texts.edited(target.connection, text);
  };

  /** The console on screen with its connection, for the grid's changes. */
  const withActive = (/** @type {(target: Console, conn: Connection) => unknown} */ fn) => {
    const { shown, conn } = active();
    return fn(shown, conn);
  };

  return {
    open,
    openText,
    ...panels,
    run,
    explain,
    serverVersion,
    format,
    more,
    edited,
    render,
    page: (/** @type {Parameters<typeof pages.page>[2]} */ change) =>
      withActive((shown, conn) => pages.page(shown, conn, change)),
    edits: {
      editCell: (
        /** @type {number} */ row,
        /** @type {number} */ col,
        /** @type {string | null} */ value,
      ) => withActive((t, c) => edits.editCell(t, c, row, col, value)),
      addRow: () => withActive((t, c) => edits.addRow(t, c)),
      deleteRows: (/** @type {number[]} */ rows) =>
        withActive((t, c) => edits.deleteRows(t, c, rows)),
      revert: (/** @type {number[] | undefined} */ rows) =>
        withActive((t) => edits.revert(t, rows)),
      preview: () => withActive((t) => edits.preview(t)),
      submit: () => withActive((t, c) => edits.submit(t, c)),
      ensure: () =>
        withActive(async (t, c) => {
          const state = await edits.ensure(t, c);
          render();
          return state;
        }),
    },
    /** Pick a result tab. */
    tab(/** @type {number} */ index) {
      const target = buffers.current();
      if (target?.shown && index >= 0 && index < target.shown.tabs.length) target.tab = index;
      render();
    },
    show: buffers.showId,
    closed: buffers.closed,
    drop: buffers.drop,
    /** Rename a connection's consoles and table views after an edit. */
    async renamed(/** @type {Connection} */ conn) {
      for (const target of buffers.list()) {
        if (target.connection !== conn.id || (target.kind !== "console" && target.kind !== "table"))
          continue;
        target.name = nameOf(conn, target.table);
        await deps.commands
          .run("desk.buffers.update", { id: target.id, name: target.name })
          .catch(() => {});
      }
      render();
    },
    current: buffers.current,
    list: buffers.list,
  };
}

/** One line about a run, for a command's answer. */
function summary(/** @type {Execution} */ execution) {
  const indexes = execution.statements.map((_, i) => i);
  return indexes.map((i) => summaryOf(execution, i)).join("; ");
}
