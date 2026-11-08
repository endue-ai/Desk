// The work area's buffers: a SQL console per connection, a page view per table and a DDL view per
// object, each a desk buffer so Mod+B and the buffer list reach it. A console runs the statement at
// the caret, the selection or the whole script (asking for its parameters first), in one of three
// modes (run, in one transaction, dry run), explains it as a plan tree, formats it, and pages or
// loads more rows of a single read. Changes in the grid wait as pending changes (edits.js); a new
// run asks before it drops them. The console's text is kept in the store, a run's statements in the
// history. No DOM: the view gets a model and hands back the editor's text and selection.

import { createRunning } from "./console-run.js";
import { createEdits } from "./edits.js";
import { createPages } from "./pages.js";
import { show, summaryOf } from "./tabs.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./execute.js").Execution} Execution
 * @typedef {import("./execute.js").Mode} Mode
 * @typedef {import("./sql/split.js").Statement} Statement
 * @typedef {import("./tabs.js").Shown} Shown
 * @typedef {{ schema: string, name: string, where: string, order: string, offset: number, count: number | null }} TablePage
 * @typedef {{
 *   id: string, kind: "console" | "table" | "ddl" | "diagram", connection: string, name: string, text: string,
 *   table: TablePage | null, execution: Execution | null, shown: Shown | null, running: boolean,
 *   tab: number, maxRows: number, edit: import("./edits.js").EditState | null,
 *   page: { statement: Statement, offset: number } | null,
 *   diagram?: { schema: string, layout: import("./schema/diagram.js").Layout },
 * }} Console
 *   `page` is set when the console's last run was one SELECT that can be paged.
 * @typedef {{
 *   console(model: Console | null, conn: Connection | null): void,
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
 * }} Deps
 */

const TEXT_LIMIT = 60 * 1024;
const textKey = (/** @type {string} */ connection) => `console:${connection}`;

/** @param {Deps} deps */
export function createConsoles(deps) {
  /** @type {Map<string, Console>} */
  const consoles = new Map();
  /** @type {string | null} */
  let current = null;
  let local = 0;
  /** The values typed for parameters this session, by connection and name. */
  /** @type {Map<string, string>} */
  const typed = new Map();
  /** The console text waiting to be kept, and its timer. */
  /** @type {{ connection: string, text: string, timer: ReturnType<typeof setTimeout> } | null} */
  let saving = null;
  const keep = () => {
    if (!saving) return;
    clearTimeout(saving.timer);
    const { connection, text } = saving;
    saving = null;
    if (text.length > TEXT_LIMIT) deps.view.say("Only the first 60 KB of this console is kept");
    void deps.bridge
      .call("store.set", { key: textKey(connection), value: text.slice(0, TEXT_LIMIT) })
      .catch(() => deps.view.say("Could not save this console."));
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

  /** @returns {Console} */
  const made = (
    /** @type {Partial<Console> & Pick<Console, "id" | "kind" | "connection" | "name">} */ fields,
  ) => ({
    text: "",
    table: null,
    execution: null,
    shown: null,
    running: false,
    tab: 0,
    maxRows: deps.settings().maxRows,
    edit: null,
    page: null,
    ...fields,
  });

  const show_ = (/** @type {Console} */ target) => {
    consoles.set(target.id, target);
    current = target.id;
    render();
    return target;
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
              ? c.kind === "table" &&
                c.table?.schema === table.schema &&
                c.table?.name === table.name
              : c.kind === "console"),
        );
    if (found) return show_(found);
    const page = table ? { ...table, where: "", order: "", offset: 0, count: null } : null;
    const text = page ? "" : await loadText(conn.id);
    const name = nameOf(conn, page);
    const target = show_(
      made({
        id: given ?? (await buffer(name)),
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
    const found = [...consoles.values()].find((c) => c.kind === "ddl" && c.name === name);
    if (found) {
      found.text = text;
      return show_(found);
    }
    return show_(made({ id: await buffer(name), kind: "ddl", connection: conn.id, name, text }));
  };

  /** A schema's ER diagram, in a buffer of its own (drawn again when it is there). */
  const openDiagram = async (
    /** @type {Connection} */ conn,
    /** @type {string} */ schema,
    /** @type {import("./schema/diagram.js").Layout} */ layout,
  ) => {
    const name = `er: ${conn.name} · ${schema}`;
    const found = [...consoles.values()].find((c) => c.kind === "diagram" && c.name === name);
    if (found) {
      found.diagram = { schema, layout };
      return show_(found);
    }
    const id = await buffer(name);
    return show_(
      made({ id, kind: "diagram", connection: conn.id, name, diagram: { schema, layout } }),
    );
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

  const { run, explain, format, more } = createRunning({ deps, active, execute, render, typed });

  /** The editor's text changed: keep it, a moment later, in the store. */
  const edited = (/** @type {string} */ text) => {
    const target = current ? consoles.get(current) : undefined;
    if (target?.kind !== "console") return;
    target.text = text;
    if (saving && saving.connection !== target.connection) keep();
    if (saving) clearTimeout(saving.timer);
    saving = { connection: target.connection, text, timer: setTimeout(keep, 400) };
  };

  /** The console on screen with its connection, for the grid's changes. */
  const withActive = (/** @type {(target: Console, conn: Connection) => unknown} */ fn) => {
    const { shown, conn } = active();
    return fn(shown, conn);
  };

  return {
    open,
    openText,
    openDiagram,
    run,
    explain,
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
        if (target.connection !== conn.id || target.kind === "ddl") continue;
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
