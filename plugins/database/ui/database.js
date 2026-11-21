// The Database plugin without its DOM: the connections, the explorer, the consoles (as many per
// connection as the person opens, and .sql files bound to one: console-files.js), table and DDL
// views and the features' panels as desk buffers, the plugin's commands (commands.js), the
// features (features/, feature-host.js), the commands for agents and the desk's requests. It talks
// only to ctx.bridge, ctx.commands and ctx.state and a view, so the SDK's test host runs it with a
// recording view and scripted clients. The view's actions come back here by name (the object this
// returns: actions.js and the features').

import { builtinActions } from "./actions.js";
import { createAgentCommands } from "./agent.js";
import { answerer, guarded } from "./answer.js";
import { createAsk } from "./ask.js";
import { createCatalog } from "./catalog.js";
import { createClients, searchPath } from "./clients.js";
import { registerCommands } from "./commands.js";
import { createCompletions } from "./completions.js";
import { loadConnections, newId, normalize, saveConnections } from "./connections.js";
import { createConsoleFiles } from "./console-files.js";
import { createConsoles } from "./consoles.js";
import { createDrags } from "./dnd.js";
import { createDropped } from "./dropped.js";
import { createExecutor } from "./execute.js";
import { createExplorer } from "./explorer.js";
import { panelsOf, registerFeatures } from "./feature-host.js";
import * as features from "./features/index.js";
import { addHistory } from "./history.js";
import { createImporter } from "./importer.js";
import { createManager } from "./manage.js";
import { answerRequests } from "./requests.js";
import { createRunner } from "./run.js";
import { bridgeStore } from "./schema-cache/store.js";
import { DEFAULTS, followSettings, fromValues, loadValues } from "./settings.js";
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
 *   copy(text: string): Promise<boolean>,
 *   preview(sql: string): void,
 *   importer(model: import("./importer.js").ImportModel | null): void,
 *   nodeAt(target: unknown): Node | undefined,
 *   focus(where: "explorer" | "editor" | "grid"): void,
 *   selection(): { tab: number, rows?: number[], columns?: number[], sorted?: (string | null)[][], visible?: number[] } | undefined,
 *   grid?(op: string, args?: Record<string, unknown>): unknown,
 *   cell(): ReturnType<ReturnType<typeof import("./view-grid.js").createGrid>["cursorCell"]>,
 * }} View
 */

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "state"> & Partial<Pick<PluginContext, "settings">>} ctx
 * @param {View} view
 * @param {{
 *   cancelled?(message: string): Error,
 *   platform?: import("./clients.js").Platform,
 *   runner?: ReturnType<typeof createRunner>,
 *   output(onBusy: (reads: number) => void): import("./output-client.js").OutputReader,
 *   features?: import("./feature-host.js").Feature[],
 *   random?(): number,
 * }} options `cancelled` makes the error a cancelled command answers with (the SDK's CommandFailed);
 *   `output` makes the result reader, which reads each run's output in a worker (main.js, #38);
 *   `features` are features/index.js's unless given.
 */
export function createDatabase({ bridge, commands, state, settings: source }, view, options) {
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
    catalog.cancel();
    runner.cancel();
    output.cancel();
  };
  const clients = createClients(runner, () => settings);
  const { pick, confirm } = createAsk(commands);
  const list = options.features ?? Object.values(features);

  const changed = () => view.explorer(explorer.rows());
  /** @type {ReturnType<typeof createManager>} */
  const manager = createManager({
    bridge,
    view,
    pick,
    confirm,
    execute: (conn, sql, opts) => execute(conn, sql, opts),
    forget: async (connection) => {
      await catalog.drop(connection);
      explorer.reread(connection);
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
  // The schema cache (ADR 0285) is kept in the plugin's store; what it read is drawn again.
  const catalog = createCatalog(executor.execute, () => settings.systemSchemas, {
    store: bridgeStore(bridge),
    changed: (connection) => explorer.reread(connection),
  });
  /** A run of the person's, an agent's or a feature's: a DDL statement in it refreshes the catalog. */
  const execute = /** @type {import("./catalog.js").Execute} */ (
    async (conn, sql, opts) => {
      const done = await executor.execute(conn, sql, opts);
      if (!opts?.catalog) catalog.ran(done);
      return done;
    }
  );
  const explorer = createExplorer(catalog, () => manager.list(), changed);
  const consoles = createConsoles({
    commands,
    bridge,
    connection: (id) => manager.get(id),
    execute,
    catalog,
    settings: () => settings,
    remember: (conn, execution, target) => {
      if (!settings.history) return;
      const entries = execution.result.statements
        .filter((s) => s.ran)
        .map((s) => ({
          at: new Date(execution.at).toISOString(),
          sql: execution.statements[s.index]?.text ?? "",
          ms: execution.result.ms,
          ok: !s.error,
          summary: summaryOf(execution, s.index),
          ...(target.consoleId ? { console: target.consoleId } : {}),
        }));
      void addHistory(bridge, conn.id, entries, settings.historyMax);
    },
    confirm,
    ask: (title, placeholder) => pick(title, [], true, placeholder),
    flavor: async (conn) => (await clients.get(conn.engine)).flavor,
    cancelled,
    view,
    changed: () => save(),
    panels: panelsOf(list),
    choose: (title) => manager.choose(undefined, title),
    fileEdited: (target) => files.edited(target),
    bound: async (target, conn) => {
      if (target.file) await files.remember(target.file.path, conn.id);
    },
    ...(options.random ? { random: options.random } : {}),
  });
  const files = createConsoleFiles({ bridge, commands, manager, consoles, view });
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

  /** What comes back after a restart: the connection on screen, the explorer, the consoles the
   * plugin opened and the kept panels. */
  const save = () => {
    const panels = consoles.kept();
    const kept = consoles.keptConsoles();
    state.set({
      current: consoles.current()?.connection ?? null,
      expanded: explorer.opened(),
      ...(kept.length ? { consoles: kept } : {}),
      ...(panels.length ? { panels } : {}),
    });
  };

  /** A file the desk opens, in the buffer given: a .sql file's console, or a SQLite file's
   * connection (added the first time). */
  const visit = async (/** @type {string} */ buffer, /** @type {string} */ path) => {
    if (/\.sql$/iu.test(path)) {
      await files.visit(buffer, path);
      return;
    }
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
    execute,
    current: () => consoles.current(),
    view,
  });
  const dropped = createDropped({ bridge, manager, consoles, files, importer, view, visit });

  const answer = answerer(commands, view);
  registerCommands({
    bridge,
    answer,
    view,
    manager,
    consoles,
    explorer,
    tools,
    execute,
    cancel,
    pick,
  });
  answerRequests({ commands, consoles, visit, files });
  createAgentCommands({
    bridge,
    commands,
    connections: () => manager.list(),
    find: manager.get,
    catalog,
    execute,
  });

  const guard = guarded(view);
  const builtins = {
    ...builtinActions({
      guard,
      view,
      manager,
      consoles,
      explorer,
      tools,
      importer,
      dropped,
      complete: createCompletions({ consoles, manager, catalog }),
      cancel,
    }),
    ...createDrags({
      current: () => consoles.current(),
      connection: (id) => manager.get(id),
      selection: () => view.selection(),
    }),
  };
  /** @type {import("./feature-host.js").Deps} */
  const featureDeps = {
    bridge,
    commands,
    view,
    manager,
    consoles,
    catalog,
    explorer,
    tools,
    execute,
    settings: () => settings,
    pick,
    confirm,
    say: (text) => view.say(text),
    guard,
    cancelled,
  };
  const taken = new Set(Object.keys(builtins));
  const featureActions = registerFeatures(list, featureDeps, { answer, taken });

  const ready = (async () => {
    const saved = /** @type {{ current?: string | null, expanded?: string[] } | undefined} */ (
      state.get()
    );
    const values = await loadValues(bridge);
    settings = fromValues(values);
    followSettings(source, values, (next, found) => {
      settings = next;
      if (found) clients.reset();
    });
    manager.replace(await loadConnections(bridge));
    explorer.restore(saved?.expanded ?? []);
    changed();
    consoles.render();
    // The consoles kept; from an older version, which kept none, the console of the one on screen.
    const back = await guard(() =>
      consoles.restoreConsoles(/** @type {{ consoles?: unknown } | undefined} */ (saved)?.consoles),
    )();
    const conn = saved?.current ? manager.get(saved.current) : undefined;
    if (!back && conn) await guard(() => consoles.open(conn))();
    const kept = /** @type {{ panels?: unknown } | undefined} */ (saved)?.panels;
    await guard(() => consoles.restore(kept))();
  })();

  return Object.assign({ ready, ...builtins }, featureActions);
}
