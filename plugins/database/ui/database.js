// The Database plugin without its DOM: the connections, the explorer, the consoles, table and DDL
// views as desk buffers, the plugin's commands (commands.js), the commands for agents and the
// desk's requests. It talks only to ctx.bridge, ctx.commands and ctx.state and a view, so the SDK's
// test host runs it with a recording view and scripted clients. The view's actions come back here
// by name (the object this returns).

import { createAgentCommands } from "./agent.js";
import { createCatalog } from "./catalog.js";
import { createClients, searchPath } from "./clients.js";
import { codeOf, registerCommands } from "./commands.js";
import { loadConnections, newId, normalize, saveConnections } from "./connections.js";
import { createConsoles } from "./consoles.js";
import { createDrags } from "./dnd.js";
import { createDropped } from "./dropped.js";
import { complete } from "./editor/complete.js";
import { engineOf } from "./engines/index.js";
import { createExecutor } from "./execute.js";
import { createExplorer } from "./explorer.js";
import { addHistory } from "./history.js";
import { createImporter } from "./importer.js";
import { createManager } from "./manage.js";
import { createRunner } from "./run.js";
import { DEFAULTS, loadSettings } from "./settings.js";
import { summaryOf } from "./tabs.js";
import { createTools } from "./tools.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./explorer.js").Node} Node
 * @typedef {import("./consoles.js").ConsoleView & import("./manage.js").Deps["view"] & {
 *   explorer(rows: Node[]): void,
 *   busy(running: number): void,
 *   reading?(reads: number): void,
 *   insert(text: string): void,
 *   copy(text: string): boolean,
 *   preview(sql: string): void,
 *   importer(model: import("./importer.js").ImportModel | null): void,
 *   nodeAt(target: unknown): Node | undefined,
 *   focus(where: "explorer" | "editor" | "grid"): void,
 *   selection(): { tab: number, rows?: number[], columns?: number[], sorted?: (string | null)[][] } | undefined,
 * }} View
 */

const COMPLETE_READS = 4;

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "state">} ctx
 * @param {View} view
 * @param {{
 *   cancelled?(message: string): Error,
 *   platform?: import("./clients.js").Platform,
 *   runner?: ReturnType<typeof createRunner>,
 *   output(onBusy: (reads: number) => void): import("./output-client.js").OutputReader,
 *   random?(): number,
 * }} options `cancelled` makes the error a cancelled command answers with (the SDK's CommandFailed);
 *   `output` makes the result reader, which reads each run's output in a worker (main.js, #38).
 */
export function createDatabase({ bridge, commands, state }, view, options) {
  let settings = DEFAULTS;
  const cancelled =
    options.cancelled ?? ((message) => Object.assign(new Error(message), { code: "cancelled" }));
  // A run is busy from the client's start until its output is read.
  let running = 0;
  let reading = 0;
  const busy = () => view.busy(running + reading);
  const runner =
    options.runner ??
    createRunner(bridge, {
      onBusy: (count) => {
        running = count;
        busy();
      },
      searchPath: () => searchPath(options.platform ?? "mac", settings.path),
    });
  const output = options.output((reads) => {
    reading = reads;
    busy();
    view.reading?.(reads);
  });
  const cancel = () => {
    runner.cancel();
    output.cancel();
  };
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
      { id: "yes", label: "Yes", ...(first ? { detail: first } : {}) },
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
      explorer.refresh(connection, undefined);
      await consoles.drop(connection);
    },
    renamed: (conn) => consoles.renamed(conn),
    changed: () => changed(),
    ...(options.random ? { random: options.random } : {}),
  });
  const executor = createExecutor({
    runner,
    output,
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
    catalog,
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
    confirm,
    ask: (title, placeholder) => pick(title, [], true, placeholder),
    flavor: async (conn) => (await clients.get(conn.engine)).flavor,
    cancelled,
    view,
    changed: () => save(),
  });
  const tools = createTools({
    bridge,
    commands,
    view,
    pick,
    manager,
    consoles,
    catalog,
    explorer,
    clients,
    settings: () => settings,
    reload: (next) => {
      settings = next;
    },
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

  const importer = createImporter({
    manager,
    catalog,
    execute: executor.execute,
    current: () => consoles.current(),
    view,
  });
  const dropped = createDropped({ bridge, manager, consoles, importer, view, visit });

  registerCommands({
    bridge,
    commands,
    view,
    manager,
    consoles,
    explorer,
    tools,
    execute: executor.execute,
    cancel,
    openConsole,
    visit,
    pick,
  });
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
        const done = await fn(...args);
        return done;
      } catch (error) {
        if (codeOf(error) === "cancelled") return undefined;
        view.say(error instanceof Error ? error.message : String(error));
        return undefined;
      }
    };

  /** Completions at the caret, after reading (quietly) the schema and tables it names. */
  const completions = async (/** @type {string} */ text, /** @type {number} */ caret) => {
    const shown = consoles.current();
    const conn = shown ? manager.get(shown.connection) : undefined;
    if (!conn) return undefined;
    const { dialect } = engineOf(conn.engine);
    const view_ = catalog.snapshot(conn);
    const quiet = (/** @type {Promise<unknown>} */ p) => p.catch(() => undefined);
    await Promise.all([
      quiet(catalog.schemas(conn, true)),
      ...(view_.defaultSchema ? [quiet(catalog.objects(conn, view_.defaultSchema, true))] : []),
    ]);
    let found = complete(text, caret, dialect, catalog.snapshot(conn));
    if (found.wants.length) {
      const reads = found.wants
        .slice(0, COMPLETE_READS)
        .map((w) => quiet(catalog.columns(conn, w.schema, w.table, true)));
      await Promise.all(reads);
      found = complete(text, caret, dialect, catalog.snapshot(conn));
    }
    return found;
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

  const edits = consoles.edits;
  return {
    ready,
    /** Activate a row of the explorer: a connection opens its console, a table its rows. */
    activate: guard(async (/** @type {Node} */ node) => {
      const conn = manager.get(node.connection);
      if (!conn) return explorer.toggle(node);
      if (node.kind === "connection") await consoles.open(conn);
      else if (node.kind === "table" && node.table)
        await consoles.open(conn, { schema: node.schema ?? "", name: node.table });
      else if (node.kind === "object" || node.kind === "part") await tools.ddl(node);
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
    explain: guard(() => consoles.explain(false)),
    explainAnalyze: guard(() => consoles.explain(true)),
    format: guard(() => consoles.format()),
    complete: (/** @type {string} */ text, /** @type {number} */ caret) =>
      completions(text, caret).catch(() => undefined),
    more: guard(() => consoles.more()),
    cancel,
    page: guard((/** @type {Parameters<typeof consoles.page>[0]} */ change) =>
      consoles.page(change),
    ),
    history: guard(() => tools.history(undefined)),
    star: guard(() => tools.star(undefined)),
    starred: guard(() => tools.starred()),
    copy: guard((/** @type {string | undefined} */ format) => tools.copy(format)),
    exportTo: guard((/** @type {string | undefined} */ format) => tools.exportTo(format)),
    ddl: guard((/** @type {Node} */ node) => tools.ddl(node)),
    diagram: guard((/** @type {Node} */ node) => tools.diagram(node)),
    openTable: guard(
      async (
        /** @type {string} */ connection,
        /** @type {string} */ schema,
        /** @type {string} */ name,
      ) => {
        const conn = manager.get(connection);
        if (conn) await consoles.open(conn, { schema, name });
        view.focus("grid");
      },
    ),
    count: guard((/** @type {Node} */ node) => tools.countRows(explorer.rows(), node)),
    filter: (/** @type {string} */ text) => explorer.filter(text),
    editCell: guard(
      (/** @type {number} */ row, /** @type {number} */ col, /** @type {string | null} */ value) =>
        edits.editCell(row, col, value),
    ),
    addRow: guard(() => edits.addRow()),
    deleteRows: guard((/** @type {number[]} */ rows) => edits.deleteRows(rows)),
    revertRows: guard((/** @type {number[] | undefined} */ rows) => edits.revert(rows)),
    previewChanges: guard(() => view.preview(edits.preview())),
    submitChanges: guard(async () => view.say(await edits.submit())),
    canEdit: guard(() => edits.ensure()),
    /** A drop on the surface (dnd.js): undefined when it was carried out, "none" when not. */
    drop: async (
      /** @type {import("./drops.js").Dropped} */ item,
      /** @type {import("./importer.js").Into | undefined} */ into,
    ) => {
      try {
        return await dropped(item, into);
      } catch (error) {
        if (codeOf(error) !== "cancelled")
          view.say(error instanceof Error ? error.message : String(error));
        return /** @type {const} */ ("none");
      }
    },
    dropped: guard((/** @type {import("./drops.js").Dropped} */ item) => dropped(item)),
    say: (/** @type {string} */ text) => view.say(text),
    importChange: guard((/** @type {import("./importer.js").Change} */ change) =>
      importer.change(change),
    ),
    importRun: guard(() => importer.run()),
    importCancel: () => importer.cancel(),
    ...createDrags({
      current: () => consoles.current(),
      connection: (id) => manager.get(id),
      selection: () => view.selection(),
    }),
    create: () => manager.create(),
    importUri: guard(() => manager.importUri(undefined)),
    edit: guard((/** @type {string | undefined} */ id) => manager.edit(id)),
    remove: guard((/** @type {string | undefined} */ id) => manager.remove(id)),
    refresh: (/** @type {string | undefined} */ id, /** @type {Node | undefined} */ node) =>
      explorer.refresh(id, node),
    formSave: guard((/** @type {Partial<Connection>} */ fields) => manager.save(fields)),
    formTest: guard((/** @type {Partial<Connection>} */ fields) => manager.test(fields)),
    formCancel: guard((/** @type {Parameters<typeof manager.cancelForm>[0]} */ fields) =>
      manager.cancelForm(fields),
    ),
    password: (/** @type {string | undefined} */ value) => manager.answered(value),
  };
}
