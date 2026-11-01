// The Database plugin without its DOM: the connections, the explorer, the consoles and table views
// as desk buffers, the plugin's commands (endue.database.*), the commands for agents and the desk's
// requests (desk.buffers.show and .closed, desk.files.visit for SQLite files). It talks only to
// ctx.bridge, ctx.commands and ctx.state and a view, so the SDK's test host runs it with a recording
// view and scripted clients.

import { createAgentCommands } from "./agent.js";
import { createCatalog, tableName } from "./catalog.js";
import { createClients, searchPath } from "./clients.js";
import { formatUri, loadConnections, newId, normalize, saveConnections } from "./connections.js";
import { createConsoles } from "./consoles.js";
import { engineOf } from "./engines/index.js";
import { createExecutor, oneLine } from "./execute.js";
import { createExplorer } from "./explorer.js";
import { addHistory, readHistory } from "./history.js";
import { createManager } from "./manage.js";
import { FORMATS, formatRows } from "./results.js";
import { createRunner } from "./run.js";
import { DEFAULTS, loadSettings } from "./settings.js";
import { summaryOf } from "./tabs.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./explorer.js").Node} Node
 * @typedef {import("./consoles.js").ConsoleView & import("./manage.js").Deps["view"] & {
 *   explorer(rows: Node[]): void,
 *   busy(running: number): void,
 *   insert(text: string): void,
 *   copy(text: string): boolean,
 *   focus(where: "explorer" | "editor" | "grid"): void,
 *   selection(): { tab: number, rows?: number[], columns?: number[], sorted?: (string | null)[][] } | undefined,
 * }} View
 */

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "state">} ctx
 * @param {View} view
 * @param {{
 *   cancelled?(message: string): Error,
 *   platform?: import("./clients.js").Platform,
 *   runner?: ReturnType<typeof createRunner>,
 *   random?(): number,
 * }} [options] `cancelled` makes the error a cancelled command answers with (the SDK's CommandFailed).
 */
export function createDatabase({ bridge, commands, state }, view, options = {}) {
  let settings = DEFAULTS;
  const cancelled =
    options.cancelled ?? ((message) => Object.assign(new Error(message), { code: "cancelled" }));
  const runner =
    options.runner ??
    createRunner(bridge, {
      onBusy: (running) => view.busy(running),
      searchPath: () => searchPath(options.platform ?? "mac", settings.path),
    });
  const clients = createClients(runner, () => settings);

  /** @param {string} title @param {{ id: string, label: string, detail?: string }[]} items */
  const pick = async (title, items, free = false, placeholder = "") => {
    try {
      const picked = await commands.run("desk.palette.pick", {
        title,
        items,
        ...(free ? { free, placeholder } : {}),
      });
      return typeof picked === "string" && picked !== "" ? picked : undefined;
    } catch (error) {
      if (codeOf(error) === "cancelled") return undefined;
      throw new Error("Cannot ask: the palette is off.");
    }
  };
  const confirm = async (/** @type {string} */ title, /** @type {string[]} */ reasons) => {
    const [first, ...rest] = reasons;
    const items = [
      { id: "yes", label: "Yes, run it", ...(first ? { detail: first } : {}) },
      ...rest.map((reason, i) => ({ id: `why-${i}`, label: reason })),
      { id: "no", label: "No" },
    ];
    return (await pick(title, items)) === "yes";
  };

  const changed = () => view.explorer(explorer.rows());
  /** @type {ReturnType<typeof createManager>} */
  const manager = createManager({
    bridge,
    view,
    pick,
    confirm,
    execute: (conn, sql, opts) => executor.execute(conn, sql, opts),
    forget: async (connection) => {
      explorer.refresh(connection);
      await consoles.drop(connection);
    },
    renamed: (conn) => consoles.renamed(conn),
    changed: () => changed(),
    ...(options.random ? { random: options.random } : {}),
  });
  const executor = createExecutor({
    runner,
    clients,
    settings: () => settings,
    confirm,
    passwords: manager.passwords,
    cancelled,
    ...(options.random ? { random: options.random } : {}),
  });
  const catalog = createCatalog(executor.execute, () => settings.systemSchemas);
  const explorer = createExplorer(catalog, () => manager.list(), changed);
  const consoles = createConsoles({
    commands,
    bridge,
    connection: (id) => manager.get(id),
    execute: executor.execute,
    settings: () => settings,
    remember: (conn, execution) => {
      if (!settings.history) return;
      const entries = execution.result.statements
        .filter((s) => s.ran)
        .map((s) => ({
          at: new Date(execution.at).toISOString(),
          sql: execution.statements[s.index]?.text ?? "",
          ms: execution.result.ms,
          ok: !s.error,
          summary: summaryOf(execution, s.index),
        }));
      void addHistory(bridge, conn.id, entries, settings.historyMax);
    },
    view,
    changed: () => save(),
  });

  const save = () =>
    state.set({ current: consoles.current()?.connection ?? null, expanded: explorer.opened() });

  /** Open a connection's console, from a name, an id or a pick; with none yet, the form. */
  const openConsole = async (/** @type {string | undefined} */ ref) => {
    if (manager.list().length === 0 && !ref) {
      manager.create();
      return null;
    }
    const conn = await manager.choose(ref, "Database: open which connection?");
    if (!conn) return null;
    await consoles.open(conn);
    view.focus("editor");
    return conn.name;
  };

  /** A SQLite file the desk opens: its connection (added the first time) in the buffer given. */
  const visit = async (/** @type {string} */ buffer, /** @type {string} */ path) => {
    let conn = manager.list().find((c) => c.engine === "sqlite" && c.file === path);
    if (!conn) {
      conn = normalize({ engine: "sqlite", file: path, id: newId(options.random) }, manager.list());
      const next = [...manager.list(), conn];
      await saveConnections(bridge, next);
      manager.replace(next);
    }
    await consoles.open(conn, null, buffer);
  };

  /** Copy the result tab on screen (or the grid's selection) as a format. */
  const copy = async (/** @type {string | undefined} */ format) => {
    const shown = consoles.current();
    const tab = shown?.shown?.tabs[shown.tab];
    if (!shown || !tab?.set) throw new Error("No result to copy: run a query first.");
    const chosen =
      format ??
      (await pick(
        "Database: copy the result as",
        FORMATS.map((id) => ({ id, label: id.toUpperCase() })),
      ));
    if (!chosen) return undefined;
    if (!FORMATS.includes(/** @type {never} */ (chosen)))
      throw new Error(`Copy as ${chosen}: pick ${FORMATS.join(", ")}.`);
    const conn = manager.get(shown.connection);
    const selection = view.selection();
    const text = formatRows(tab.set, /** @type {import("./results.js").Format} */ (chosen), {
      ...(conn ? { dialect: /** @type {import("./sql/lexer.js").Dialect} */ (conn.engine) } : {}),
      table: shown.table && conn ? tableName(conn, shown.table.schema, shown.table.name) : "t",
      ...(selection?.sorted
        ? {
            rows: selection.rows
              ? selection.rows.map((i) => /** @type {(string | null)[]} */ (selection.sorted?.[i]))
              : selection.sorted,
          }
        : {}),
      ...(selection?.columns ? { columns: selection.columns } : {}),
    });
    view.say(
      view.copy(text)
        ? `Copied as ${chosen.toUpperCase()}.`
        : "The clipboard refused: select the grid and press Mod+C.",
    );
    return text;
  };

  /** Pick an earlier statement of this connection and put it in the editor. */
  const history = async () => {
    const shown = consoles.current();
    if (shown?.kind !== "console") throw new Error("History goes into a console: open one first.");
    const entries = await readHistory(bridge, shown.connection);
    if (entries.length === 0) throw new Error("Nothing ran on this connection yet.");
    const items = entries.map((e, i) => ({
      id: String(i),
      label: oneLine(e.sql),
      detail: `${e.at.slice(0, 16).replace("T", " ")} · ${e.ok ? "" : "failed: "}${e.summary}`,
    }));
    const picked = await pick("Database: history", items);
    const entry = picked === undefined ? undefined : entries[Number(picked)];
    if (entry) view.insert(entry.sql);
    return entry?.sql;
  };

  /** Find each engine's client again and say what was found. */
  const checkClients = async () => {
    settings = await loadSettings(bridge);
    clients.reset();
    const lines = await Promise.all(
      /** @type {const} */ (["postgresql", "mysql", "sqlite"]).map((engine) =>
        clients.get(engine).then(
          (c) => `${c.command} ${c.version} (${c.flavor})`,
          (error) => (error instanceof Error ? error.message : String(error)),
        ),
      ),
    );
    view.say(lines.join(" · "));
    return lines;
  };

  /**
   * Answer a command or a request: a failure goes to the status line and ends the request with the
   * same words; a success clears nothing but says what it did.
   * @param {string} name
   * @param {(args: any) => unknown} handler
   */
  const answer = (name, handler) =>
    commands.on(name, async (args) => {
      try {
        return await handler(args ?? {});
      } catch (error) {
        if (codeOf(error) !== "cancelled")
          view.say(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });

  answer("endue.database.open", ({ connection }) => openConsole(connection));
  answer("endue.database.console", ({ connection }) => openConsole(connection));
  answer("endue.database.new-connection", (fields) => manager.create(fields));
  answer("endue.database.import-uri", ({ uri }) => manager.importUri(uri));
  answer("endue.database.edit-connection", ({ connection }) => manager.edit(connection));
  answer("endue.database.duplicate-connection", ({ connection }) => manager.duplicate(connection));
  answer("endue.database.remove-connection", ({ connection }) => manager.remove(connection));
  answer("endue.database.disconnect", ({ connection }) => manager.disconnect(connection));
  answer("endue.database.test-connection", async ({ connection }) => {
    const conn = await manager.choose(connection, "Database: test which connection?");
    if (!conn) return undefined;
    const done = await executor.execute(conn, engineOf(conn.engine).versionSql, { catalog: true });
    const error = done.result.error ?? done.result.statements[0]?.error;
    if (error) throw new Error(`${conn.name}: ${error.message}`);
    const version = done.result.statements[0]?.sets[0]?.rows[0]?.[0] ?? "";
    view.say(`${conn.name}: connected in ${done.result.ms} ms, ${version}`);
    return version;
  });
  answer("endue.database.copy-uri", async ({ connection }) => {
    const conn = await manager.choose(connection, "Database: copy which connection's URI?");
    if (!conn) return undefined;
    const uri = formatUri(conn);
    view.say(view.copy(uri) ? `Copied ${uri}` : uri);
    return uri;
  });
  answer("endue.database.run", () => consoles.run("statement"));
  answer("endue.database.run-all", () => consoles.run("all"));
  answer("endue.database.run-transaction", () => consoles.run("all", "transaction"));
  answer("endue.database.dry-run", () => consoles.run("all", "dry-run"));
  answer("endue.database.explain", () => consoles.explain());
  answer("endue.database.more", () => consoles.more());
  answer("endue.database.cancel", () => {
    runner.cancel();
    view.say("Cancelling…");
  });
  answer("endue.database.open-table", async ({ connection, schema, table }) => {
    const conn = await manager.choose(connection, "Database: which connection?");
    if (!conn || typeof table !== "string")
      throw new Error("Open a table from the explorer, or name connection, schema and table.");
    await consoles.open(conn, { schema: typeof schema === "string" ? schema : "", name: table });
    view.focus("grid");
  });
  answer("endue.database.refresh", async ({ connection }) => {
    const conn = connection ? manager.get(connection) : undefined;
    explorer.refresh(conn?.id);
    manager.replace(await loadConnections(bridge));
  });
  answer("endue.database.history", history);
  answer("endue.database.copy", ({ format }) => copy(format));
  answer("endue.database.clients", checkClients);

  commands.on("desk.buffers.show", (args) => consoles.show(bufferOf(args)));
  commands.on("desk.buffers.closed", (args) => consoles.closed(bufferOf(args)));
  commands.on("desk.files.visit", (args) => {
    const { buffer, path } = /** @type {{ buffer?: string, path?: string }} */ (args ?? {});
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    return visit(buffer, path);
  });
  // A database file has nothing to save or revert: every run is written by the client.
  commands.on("desk.files.save", () => undefined);
  commands.on("desk.files.revert", () => undefined);

  createAgentCommands({
    bridge,
    commands,
    connections: () => manager.list(),
    find: manager.get,
    catalog,
    execute: executor.execute,
  });

  /** The view's buttons and keys: a failure is said, never thrown at the DOM. */
  const guard =
    (/** @type {(...args: any[]) => unknown} */ fn) =>
    async (/** @type {unknown[]} */ ...args) => {
      try {
        await fn(...args);
      } catch (error) {
        if (codeOf(error) === "cancelled") return;
        view.say(error instanceof Error ? error.message : String(error));
      }
    };

  const ready = (async () => {
    const saved = /** @type {{ current?: string | null, expanded?: string[] } | undefined} */ (
      state.get()
    );
    settings = await loadSettings(bridge);
    manager.replace(await loadConnections(bridge));
    explorer.restore(saved?.expanded ?? []);
    changed();
    consoles.render();
    const conn = saved?.current ? manager.get(saved.current) : undefined;
    if (conn) await guard(() => consoles.open(conn))();
  })();

  return {
    ready,
    /** Activate a row of the explorer: a connection opens its console, a table its rows. */
    activate: guard(async (/** @type {Node} */ node) => {
      const conn = manager.get(node.connection);
      if (!conn) return;
      if (node.kind === "connection") await consoles.open(conn);
      else if (node.kind === "table" && node.table)
        await consoles.open(conn, { schema: node.schema ?? "", name: node.table });
      else explorer.toggle(node);
    }),
    toggle: (/** @type {Node} */ node, /** @type {boolean | undefined} */ open) =>
      explorer.toggle(node, open),
    edited: (/** @type {string} */ text) => consoles.edited(text),
    tab: (/** @type {number} */ index) => consoles.tab(index),
    run: guard(() => consoles.run("statement")),
    runAll: guard(() => consoles.run("all")),
    runTransaction: guard(() => consoles.run("all", "transaction")),
    dryRun: guard(() => consoles.run("all", "dry-run")),
    explain: guard(() => consoles.explain()),
    more: guard(() => consoles.more()),
    cancel: () => runner.cancel(),
    page: guard((/** @type {Parameters<typeof consoles.page>[0]} */ change) =>
      consoles.page(change),
    ),
    history: guard(history),
    copy: guard(copy),
    create: () => manager.create(),
    importUri: guard(() => manager.importUri(undefined)),
    edit: guard((/** @type {string | undefined} */ id) => manager.edit(id)),
    remove: guard((/** @type {string | undefined} */ id) => manager.remove(id)),
    refresh: (/** @type {string | undefined} */ id) => explorer.refresh(id),
    formSave: guard((/** @type {Partial<Connection>} */ fields) => manager.save(fields)),
    formTest: guard((/** @type {Partial<Connection>} */ fields) => manager.test(fields)),
    formCancel: () => manager.cancelForm(),
    password: (/** @type {string | undefined} */ value) => manager.answered(value),
  };
}

/** The buffer id a desk request names. */
const bufferOf = (/** @type {unknown} */ args) =>
  /** @type {{ buffer?: string }} */ args?.buffer ?? "";

/** The bridge or command code an error carries, if any. */
const codeOf = (/** @type {unknown} */ error) => /** @type {{ code?: string }} */ (error)?.code;
