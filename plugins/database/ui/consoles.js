// The work area's buffers: as many SQL consoles per connection as the person opens, a .sql file's
// console bound to it (console-many.js, ADR 0286), a page view per table, a DDL view per object and
// the features' panels (panels.js), each a desk buffer (buffers.js) so Mod+B and the buffer list
// reach it. A console runs the statement at the caret, the selection or the whole script (asking
// for its parameters first), in one of three modes (run, in one transaction, dry run), explains it
// as a plan tree, formats it, and pages or loads more rows of a single read. Changes in the grid
// wait as pending changes (edits.js); a new run asks before it drops them. A console's text is
// kept under its own id (console-text.js), a run's statements in the history. On PostgreSQL a
// console and a table view each run on a session of their own (PG-02, ADR 0320), whose state the
// model carries (`session`) and which closes with the buffer, asked first while a transaction is
// open. No DOM: the view gets a model and hands back the editor's text and selection.

import { createBuffers } from "./buffers.js";
import { createMany } from "./console-many.js";
import { createRunning } from "./console-run.js";
import { createTexts } from "./console-text.js";
import { createEdits } from "./edits.js";
import { createPages } from "./pages.js";
import { createPanels } from "./panels.js";
import { keyOf, ownerOf, sessionLabel } from "./session/owners.js";
import { reasonsOf, rolledBackOnClose } from "./session/words.js";
import { show, summaryOf } from "./tabs.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./execute.js").Execution} Execution
 * @typedef {import("./execute.js").Mode} Mode
 * @typedef {import("./sql/split.js").Statement} Statement
 * @typedef {import("./tabs.js").Shown} Shown
 * @typedef {{
 *   schema: string, name: string, where: string, order: string, offset: number, count: number | null,
 *   sort?: import("./grid/filters.js").SortKey[], filters?: import("./grid/filters.js").Filter[],
 * }} TablePage
 *   `sort` and `filters` are the grid's sort keys and quick filters, run on the server (pages.js).
 * @typedef {{ path: string, saved: string, modified: boolean, large: boolean, size: number }} SqlFile
 *   A .sql file a console is bound to: its text as last read or saved, whether the console's
 *   differs, and whether it is past the editor's limit (not loaded, console-files.js).
 * @typedef {{
 *   id: string, kind: string, connection: string, name: string, text: string,
 *   table: TablePage | null, execution: Execution | null, shown: Shown | null, running: boolean,
 *   tab: number, maxRows: number, edit: import("./edits.js").EditState | null,
 *   page: { statement: Statement, offset: number } | null,
 *   consoleId?: string, number?: number, title?: string, file?: SqlFile, visited?: true,
 *   used?: number, filing?: boolean, session?: import("./session/words.js").SessionModel,
 *   [panel: string]: any,
 * }} Console
 *   `kind` is "console", "table", "ddl" or a feature's panel type, whose state sits under that
 *   type's name (`diagram` for the ER diagram). `page` is set when the console's last run was one
 *   SELECT that can be paged. A console has its own id (`consoleId`, console-list.js), its number
 *   among its connection's, the person's name for it (`title`), a bound .sql file (`file`);
 *   `visited` when the desk opened its buffer for a file; `used` counts when it was on screen
 *   last; `filing` while a file runs in it (features/consoles/run-file.js); `session` the state
 *   of its PostgreSQL session, as the header shows it.
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
 *   remember(conn: Connection, execution: Execution, target: Console): void,
 *   confirm(title: string, reasons: string[]): Promise<boolean>,
 *   ask(title: string, placeholder: string): Promise<string | undefined>,
 *   flavor(conn: Connection): Promise<string>,
 *   cancelled(message: string): Error,
 *   view: ConsoleView,
 *   changed(): void,
 *   panels?: Record<string, Pick<import("./feature-host.js").Panel, "keep">>,
 *   choose?(title: string): Promise<Connection | undefined>,
 *   fileEdited?(target: Console): void,
 *   bound?(target: Console, conn: Connection): Promise<void> | void,
 *   random?(): number,
 *   readPlan?(set: import("./engines/common.js").ResultSet): Promise<import("./explain/node.js").PlanNode | undefined>,
 *   sessions?: Pick<ReturnType<typeof import("./engines/pg-session.js").createSessions>, "state" | "forget" | "inTransaction">,
 * }} Deps
 *   `panels` are the features' panel types (feature-host.js); `choose` asks for a connection, a
 *   .sql file's console's when it has none; `fileEdited` hears an edit of a bound file's console
 *   and `bound` its connection picked (console-files.js); `readPlan` reads a big plan in the plan
 *   worker (explain/reader.js), and plans are read in place without it; `sessions` keeps the
 *   PostgreSQL sessions (engines/pg-session.js).
 */

/** @param {Deps} deps */
export function createConsoles(deps) {
  const who = (/** @type {Console} */ target) =>
    ownerOf(target, deps.connection(target.connection));
  /** A buffer's session in a transaction, with what the person calls the buffer. */
  const inTransaction = (/** @type {Console} */ target) => {
    const owner = who(target)?.owner;
    const open = owner ? (deps.sessions?.inTransaction((e) => e.owner === owner) ?? []) : [];
    const label = sessionLabel(target, deps.connection(target.connection));
    return open.map((e) => ({ label, transaction: e.transaction }));
  };
  /** The sentence a close asks with while the buffer's transaction is open. */
  const closing = (/** @type {Console} */ target) => reasonsOf(inTransaction(target));
  /** A buffer that goes, or moves to another connection: its session closes. */
  const release = (/** @type {Console} */ target) => {
    const owner = keyOf(target);
    if (owner) deps.sessions?.forget(owner);
  };
  const buffers = createBuffers({
    ...deps,
    decorate: (model) => {
      const owner = who(model)?.owner;
      if (owner && deps.sessions) model.session = deps.sessions.state(owner);
      else delete model.session;
    },
    gone: (target) => release(target),
  });
  const panels = createPanels(buffers, deps);
  const texts = createTexts(deps);
  const many = createMany(buffers, texts, { ...deps, closing, release });
  const { render } = buffers;
  /** The values typed for parameters this session, by console and name. */
  /** @type {Map<string, string>} */
  const typed = new Map();

  const tableName = (/** @type {Connection} */ conn, /** @type {TablePage} */ table) =>
    `db: ${conn.name} · ${table.schema ? `${table.schema}.` : ""}${table.name}`;

  /**
   * Show a connection's console (the one used last, else its first), or a table's view, opening its
   * buffer the first time (under `filters`, its first page read with them: a followed key's, PG-41).
   * @param {Connection} conn
   * @param {{ schema: string, name: string, filters?: import("./grid/filters.js").Filter[] } | null} [table]
   * @param {string} [given] A buffer the desk opened already (a visited SQLite file).
   */
  const open = async (conn, table = null, given = undefined) => {
    if (!table) return given ? many.openIn(conn, given) : many.open(conn);
    const found = buffers.find(
      (c) =>
        c.connection === conn.id &&
        c.kind === "table" &&
        c.table?.schema === table.schema &&
        c.table?.name === table.name,
    );
    if (found) return buffers.show(found);
    const filters = table.filters ?? [];
    const page = { ...table, where: "", order: "", offset: 0, count: null, sort: [], filters };
    const name = tableName(conn, page);
    const id = await buffers.open(name);
    const target = buffers.show(
      buffers.made({ id, kind: "table", connection: conn.id, name, table: page }),
    );
    await pages.refresh(target, conn);
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
    if (!conn && shown.file)
      throw new Error(
        "Pick the connection it runs on: Database: run this .sql file on another connection.",
      );
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
   * @param {{ mode?: Mode, base?: number, statements?: Statement[], maxRows?: number, history?: boolean, file?: boolean, agent?: boolean }} options
   *   `file` is a part of a file run (features/consoles/run-file.js), which holds the console;
   *   `agent` runs it for an agent, whose writes the executor asks the person about.
   */
  const execute = async (target, conn, sql, options) => {
    if (target.running || (target.filing && !options.file))
      throw new Error("A run is going on in this console: cancel it first.");
    await discard(target);
    target.running = true;
    deps.view.say("");
    render();
    try {
      const maxRows = options.maxRows ?? deps.settings().maxRows;
      const session = ownerOf(target, conn);
      const execution = await deps.execute(conn, sql, {
        mode: options.mode ?? "run",
        maxRows,
        ...(options.statements ? { statements: options.statements } : {}),
        ...(session ? { session } : {}),
        ...(options.agent ? { agent: true, interactive: false } : {}),
      });
      target.execution = execution;
      target.shown = show(execution, options.base ?? 0);
      target.tab = target.shown.open;
      target.maxRows = maxRows;
      target.edit = null;
      if (options.history !== false) deps.remember(conn, execution, target);
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

  /** The editor's text changed: keep it, a moment later, in the store; a file's, mark it. */
  const edited = (/** @type {string} */ text) => {
    const target = buffers.current();
    if (target?.kind !== "console") return;
    target.text = text;
    if (target.file) deps.fileEdited?.(target);
    else texts.edited(target.consoleId ?? target.connection, text);
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
    run: async (/** @type {"statement" | "all"} */ scope, /** @type {Mode | undefined} */ mode) => {
      await many.ready();
      return run(scope, mode);
    },
    explain: async (/** @type {boolean} */ analyze, /** @type {string[] | undefined} */ on) => {
      await many.ready();
      return explain(analyze, on);
    },
    serverVersion,
    format,
    more,
    edited,
    render,
    openNew: many.openNew,
    openFile: many.openFile,
    close: many.close,
    rename: many.rename,
    bind: many.bind,
    consoles: many.list,
    find: many.find,
    keptConsoles: many.kept,
    restoreConsoles: many.restore,
    /** Run SQL in a console as a run of its own does (features/consoles/run-file.js). */
    runIn: execute,
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
      // A paste, a fill or a duplicate (features/paste/): planned on `ready`'s state, one `step`.
      ready: () => withActive((t, c) => edits.ready(t, c)),
      step: (
        /** @type {import("./edits.js").EditState} */ state,
        /** @type {Parameters<typeof edits.step>[2]} */ step,
      ) => withActive((t) => edits.step(t, state, step)),
      undo: () => withActive((t) => edits.undo(t)),
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
    /** The desk closed one of the plugin's buffers: its session closes, a transaction said. */
    closed(/** @type {string} */ id) {
      const target = buffers.get(id);
      const [open] = target ? inTransaction(target) : [];
      many.closed(id);
      if (open) deps.view.say(rolledBackOnClose(open.label));
    },
    drop: buffers.drop,
    /** Rename a connection's consoles and table views after an edit. */
    async renamed(/** @type {Connection} */ conn) {
      await many.renamed(conn);
      for (const target of buffers.list()) {
        if (target.connection !== conn.id || target.kind !== "table" || !target.table) continue;
        target.name = tableName(conn, target.table);
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
