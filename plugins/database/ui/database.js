// The Database plugin without its DOM: the connections, the explorer, the consoles (as many per
// connection as the person opens; console-files.js binds .sql files), table, DDL and feature panels
// as desk buffers, the commands (commands.js, feature-host.js, agents': each call watched for who
// makes it, features/audit/) and the desk's requests. It talks only to ctx.bridge, ctx.commands,
// ctx.state and a view, so the SDK's test host runs it; the view's actions come back here by name.

import { builtinActions } from "./actions.js";
import { createAgentCommands } from "./agent.js";
import { answerer, guarded } from "./answer.js";
import { createAsk } from "./ask.js";
import { createCatalog } from "./catalog.js";
import { createClients, runsOn } from "./clients.js";
import { registerCommands } from "./commands.js";
import { loadConnections, newId, normalize, saveConnections } from "./connections.js";
import { createConsoleFiles } from "./console-files.js";
import { formatText } from "./console-run.js";
import { createConsoles } from "./consoles.js";
import { createConsoleCopies } from "./copy/console.js";
import { ownDatabase } from "./databases.js";
import { createDrags } from "./dnd.js";
import { createDropped } from "./dropped.js";
import { createExecutor } from "./execute.js";
import { createExplorer } from "./explorer.js";
import { panelsOf, registerFeatures } from "./feature-host.js";
import { createAgents } from "./features/audit/agents.js";
import { createCompletion } from "./features/completion/controller.js";
import * as features from "./features/index.js";
import { addHistory } from "./history.js";
import { createImporter } from "./importer.js";
import { createKeychain } from "./keychain.js";
import { createDatabasesManager } from "./manage-databases.js";
import { answerRequests } from "./requests.js";
import { createRunner } from "./run.js";
import { bridgeStore } from "./schema-cache/store.js";
import { createPluginSessions } from "./session/plugin.js";
import { DEFAULTS } from "./settings.js";
import { effectsOf, followSettings } from "./settings-follow.js";
import { summaryOf } from "./tabs.js";
import { createTools } from "./tools.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./explorer.js").Node} Node
 * @typedef {import("./consoles.js").ConsoleView & import("./manage.js").Deps["view"] & import("./copy/console.js").View & {
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
 *   dialog?(type: string, model: unknown): Promise<unknown>,
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
 *   plans?: import("./explain/reader.js").PlanReader,
 *   startWorker?: import("./explain/reader.js").StartWorker,
 * }} options `cancelled` makes the error a cancelled command answers with (the SDK's CommandFailed);
 *   `output` makes the result reader, which reads each run's output in a worker (main.js, #38);
 *   `features` are features/index.js's unless given; `plans` reads big plans in a worker;
 *   `startWorker` starts a feature's worker (none: a feature reads in place).
 */
export function createDatabase({ bridge, commands: raw, state, settings: source }, view, options) {
  const commands = createAgents(bridge, () => featureDeps).gate.watch(raw);
  let settings = DEFAULTS;
  const cancelled =
    options.cancelled ?? ((message) => Object.assign(new Error(message), { code: "cancelled" }));
  // A run is busy from the client's start until its output is read, or while its session runs.
  let running = 0;
  let reading = 0;
  let sessions = 0;
  const busy = () => view.busy(running + reading + sessions);
  const runner =
    options.runner ??
    createRunner(bridge, {
      onBusy: (count) => {
        running = count;
        busy();
      },
      ...runsOn(options.platform ?? "mac", () => settings.path),
    });
  const output = options.output((reads) => {
    reading = reads;
    busy();
    view.reading?.(reads);
  });
  // PostgreSQL's runs on the core's sessions (ADR 0281, 0320); a password command runs (ADR 0354).
  const held = createPluginSessions({
    bridge,
    runner,
    confirm: (title, reasons) => confirm(title, reasons),
    view,
    consoles: () => consoles,
    connection: (id) => manager.get(id),
    settings: () => settings,
    onBusy: (count) => {
      sessions = count;
      busy();
    },
    kept: (conn) => manager.passwords.ref(conn), // the keychain's password signs in (ADR 0311)
    askPassphrase: (conn, why) => manager.passwords.ask(conn, why, true), // ADR 0331
  });
  const cancel = () => {
    catalog.cancel();
    runner.cancel();
    held.pg.cancel(held.scope());
    output.cancel();
  };
  const clients = createClients(runner, () => settings, options.platform ?? "mac");
  const { pick, confirm } = createAsk(commands);
  const list = options.features ?? Object.values(features);

  const changed = () => view.explorer(explorer.rows());
  // Passwords the desk keeps in the OS keychain (ADR 0311); the plugin never reads one back.
  const keychain = createKeychain(bridge, () => changed());
  const manager = createDatabasesManager({
    bridge,
    view,
    pick,
    confirm,
    execute: (conn, sql, opts) => execute(conn, sql, opts),
    keychain,
    forget: async (connection) => {
      await catalog.drop(connection);
      explorer.reread(connection);
      await consoles.drop(connection);
    },
    renamed: (conn) => consoles.renamed(conn),
    changed: () => changed(),
    sessions: held.connections,
    cancelled,
    ...(options.random ? { random: options.random } : {}),
  });
  const executor = createExecutor({
    runner,
    output,
    clients,
    sessions: held.pg,
    settings: () => settings,
    confirm,
    passwords: manager.passwords,
    cancelled,
    copies: createConsoleCopies(bridge, view),
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
  const explorer = createExplorer(catalog, () => manager.list(), changed, keychain.has);
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
          ...(conn.engine === "postgresql" ? { database: ownDatabase(conn) } : {}),
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
    ...(options.plans ? { readPlan: options.plans.read } : {}),
    sessions: held.pg,
  });
  const files = createConsoleFiles({
    bridge,
    commands,
    manager,
    consoles,
    view,
    // Format on save: by the format of the file's connection; on none yet, as typed.
    format: async (target) => {
      const conn = settings.formatOnSave ? manager.get(target.connection) : undefined;
      if (!conn) return undefined;
      const laid = await formatText(target.text, conn.engine, settings);
      if (laid.left > 0 && consoles.current() === target) view.say(laid.note);
      return laid;
    },
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
    reload: () => follower.reload(),
  });

  /** What comes back after a restart: the connection on screen, the explorer, the consoles the
   * plugin opened, the kept panels, and the consoles' sessions for a frame that wakes. */
  const save = () => {
    const panels = consoles.kept();
    const open = consoles.keptConsoles();
    const consoleSessions = held.pg.kept();
    state.set({
      current: consoles.current()?.connection ?? null,
      expanded: explorer.opened(),
      ...(open.length ? { consoles: open } : {}),
      ...(panels.length ? { panels } : {}),
      ...(consoleSessions.length ? { sessions: consoleSessions } : {}),
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
  /** @type {Set<(next: import("./settings.js").Settings) => void>} */
  const followers = new Set();
  // Settings while running (PG-104): in force at the next run, open takes it where safe; said once.
  const effects = effectsOf({
    clients,
    catalog,
    explorer,
    connections: () => manager.list(),
    redraw: () => changed(),
    features: followers,
  });
  const follower = followSettings({
    bridge,
    ...(source ? { source } : {}),
    say: (text) => view.say(text),
    apply: (next, changed) => {
      settings = next;
      effects(next, changed);
    },
  });
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
    runner,
    clients,
    ...(options.startWorker ? { startWorker: options.startWorker } : {}),
    settings: () => settings,
    onSettings: (listener) => {
      followers.add(listener);
      return () => void followers.delete(listener);
    },
    pick,
    confirm,
    say: (text) => view.say(text),
    guard,
    cancelled,
    dialog: (type, model) => (view.dialog ? view.dialog(type, model) : Promise.resolve(undefined)),
  };
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
      complete: createCompletion(featureDeps).complete,
      cancel,
    }),
    ...createDrags({
      current: () => consoles.current(),
      connection: (id) => manager.get(id),
      selection: () => view.selection(),
    }),
  };
  const taken = new Set(Object.keys(builtins));
  const featureActions = registerFeatures(list, featureDeps, { answer, taken });

  const ready = (async () => {
    const saved = /** @type {{ current?: string | null, expanded?: string[] } | undefined} */ (
      state.get()
    );
    settings = await follower.start();
    manager.replace(await loadConnections(bridge));
    await keychain.load();
    explorer.restore(saved?.expanded ?? []);
    changed();
    consoles.render();
    // The consoles kept; from an older version, which kept none, the console of the one on screen.
    const back = await guard(() =>
      consoles.restoreConsoles(/** @type {{ consoles?: unknown } | undefined} */ (saved)?.consoles),
    )();
    const conn = saved?.current ? manager.get(saved.current) : undefined;
    if (!back && conn) await guard(() => consoles.open(conn))();
    const panels = /** @type {{ panels?: unknown } | undefined} */ (saved)?.panels;
    await guard(() => consoles.restore(panels))();
    // A frame that wakes (ADR 0134): its consoles' sessions are theirs again, any other closed.
    if (saved)
      await guard(() => held.adopt(/** @type {{ sessions?: unknown }} */ (saved).sessions))();
  })();

  return Object.assign({ ready, ...builtins }, featureActions);
}
