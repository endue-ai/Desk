// The Docker plugin without its DOM: the engine it talks to (context, versions, what is wrong), the
// lists and which one is on screen (shelf.js), the detail pane beside them (pane.js, docker-pane.js)
// as desk buffers, each list's query and sort, and the live updates (live.js, watch.js, stats.js)
// that keep it all current. commands.js answers the plugin's commands on top. It talks only to
// ctx.bridge, ctx.commands, ctx.state and a view, so the SDK's test host runs it with a recording
// view and a scripted docker.

import { createActions } from "./actions.js";
import { createMoreActions } from "./actions-more.js";
import { createOps } from "./actions-ops.js";
import { createDesk, guarded } from "./desk.js";
import { createPaneControl } from "./docker-pane.js";
import { createEngine } from "./engine.js";
import { hints, LISTS } from "./keys.js";
import { createLoaders } from "./lists.js";
import { createLive } from "./live.js";
import { createLogs } from "./logs.js";
import { createPane } from "./pane.js";
import { createPrefs, QUERIED } from "./prefs.js";
import { contextName } from "./refs.js";
import { createRunner } from "./run.js";
import { DEFAULTS, loadSettings } from "./settings.js";
import { createShelf } from "./shelf.js";
import { createUse } from "./stats.js";
import { createAlerts, createWatcher, SYSTEM_CLOCK } from "./watch.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("./keys.js").ViewName} ViewName
 * @typedef {import("./view-types.js").ListName} ListName
 * @typedef {import("./view-types.js").View} View
 * @typedef {import("./view-types.js").StatsRead} StatsRead
 * @typedef {import("./view-types.js").LogsView} LogsView
 * @typedef {import("./engine.js").Header} Header
 * @typedef {import("./logs.js").LogTarget} LogTarget
 * @typedef {import("./logs.js").LogModel} LogModel
 * @typedef {import("./query.js").Prefs} Prefs
 * @typedef {import("./watch.js").Clock} Clock
 * @typedef {{ view?: ViewName, back?: string, all?: boolean, logs?: LogTarget | null,
 *   detail?: string | null, prefs?: unknown }} Saved
 * @typedef {{ runner?: ReturnType<typeof createRunner>, clock?: Clock, flushMs?: number,
 *   cancelled?(message: string): Error }} Options
 */

const CONTEXT_KEY = "context";
const isList = (/** @type {string} */ name) =>
  /** @type {readonly string[]} */ (LISTS).includes(name);
/** The lists that show containers: resource use streams while one is on screen. */
const SHOWS_CONTAINERS = new Set(["overview", "containers", "compose"]);
/** Lists an older version saved under names it no longer has. */
const RENAMED = /** @type {Record<string, ListName>} */ ({ system: "overview" });
const inPane = (/** @type {ViewName} */ name) => name === "inspect" || name === "logs";

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "state">} ctx
 * @param {View} view
 * @param {Options} [options] `cancelled` makes the error a cancelled command answers with.
 */
export function createDocker({ bridge, commands, state }, view, options = {}) {
  const clock = options.clock ?? SYSTEM_CLOCK;
  let settings = DEFAULTS;
  let context = "";
  const runner =
    options.runner ??
    createRunner(bridge, {
      onBusy: (running) => view.busy(running),
      context: () => context,
      path: () => settings.path,
    });
  /** @type {ViewName} */
  let current = "overview";
  /** The list on screen, beside the pane; `q` comes back to it. @type {ListName} */
  let back = "overview";
  let all = true;
  const prefs = createPrefs();
  let timestamps = false;
  let filter = "";
  const { pick, buffer, buffers, viewOf } = createDesk(commands);
  let said = "";
  /** Whether the event stream was lost and is being started again. */
  let lost = false;

  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.say(text);
  };

  const engine = createEngine({
    runner,
    view,
    context: () => context,
    live: () => watcher.watching(),
  });

  /** Run docker; a failure that says the engine is unreachable goes to the header too. */
  const docker = async (
    /** @type {string[]} */ args,
    /** @type {import("./run.js").RunOptions} */ runOptions = {},
  ) => {
    try {
      return await runner.run(args, runOptions);
    } catch (error) {
      engine.failed(error);
      throw error;
    }
  };

  const loaders = createLoaders(docker);
  const { history, read, stream } = createUse({
    runner,
    clock,
    interval: () => settings.statsInterval,
    show: (next) => view.stats(next),
  });
  const pane = createPane({
    docker,
    view,
    settings: () => settings,
    clock,
    changed: () => wantStats(),
  });
  /** Stream resource use while containers are on screen and the engine answers. */
  const wantStats = () =>
    stream.want(
      settings.statsInterval > 0 &&
        engine.up() &&
        (SHOWS_CONTAINERS.has(back) || pane.kind() === "container"),
    );
  const shelf = createShelf({
    loaders,
    view,
    engine,
    stats: () => history.latest(),
    context: () => context,
    all: () => all,
  });
  const { models, load } = shelf;

  const alerts = createAlerts({
    notify: (alert) =>
      void bridge
        .call("ui.notify", { ...alert, scope: { permission: "ui:notify" } })
        .catch(() => {}),
    mode: () => settings.notify,
    now: clock.now,
  });
  const watcher = createWatcher({
    runner,
    clock,
    onEvent: (event) => {
      alerts.feed(event);
      live.invalidate(event.type, event.id);
    },
    onState: (state) => {
      engine.header();
      // Back after the engine went away (Docker Desktop restarted): read what is on screen again.
      if (state === "watching" && lost)
        void engine
          .probe()
          .then(refresh)
          .catch(() => {});
      lost = state === "retrying";
      wantStats();
    },
  });

  const drawLogs = (/** @type {LogModel} */ model) => view.logs({ ...model, timestamps, filter });
  const logs = createLogs({
    runner,
    limits: () => ({ tail: settings.logTail, max: settings.logMax }),
    onChange: drawLogs,
    ...(options.flushMs !== undefined ? { flushMs: options.flushMs } : {}),
  });

  const save = () =>
    state.set({
      view: current,
      back,
      all,
      logs: logs.model().target,
      detail: control.detail()?.id ?? null,
      prefs: prefs.saved(),
    });

  const show = (/** @type {ViewName} */ name) => {
    current = name;
    if (isList(name)) back = /** @type {ListName} */ (name);
    view.show(name, hints(name));
    view.focus();
    save();
    wantStats();
  };

  /** Show a list, read fresh. */
  const showList = async (/** @type {ListName} */ name) => {
    show(name);
    return load(name);
  };

  const control = createPaneControl({
    pane,
    view,
    logs,
    docker,
    settings: () => settings,
    buffer,
    show,
    showList,
    save,
    say,
    current: () => current,
    back: () => back,
    resetFilter: () => {
      filter = "";
    },
  });
  const { selection } = control;

  const live = createLive({
    clock,
    shown: () => back,
    load,
    forget: (name) => delete models[name],
    detailId: () => pane.containerId(),
    reloadDetail: control.reloadDetail,
    failed: (error) => say(error instanceof Error ? error.message : String(error)),
  });

  /** Refresh what is on screen: the list and what the pane shows (logs from their tail again). */
  const refresh = async () => {
    // Try again after the engine was not there: ask who it is before reading what it holds.
    if (!engine.up() && (await engine.probe())) watcher.start();
    const model = pane.model();
    if (current === "logs") {
      const { target, follow } = logs.model();
      if (target) await logs.open(target, { follow });
      return;
    }
    if (inPane(current) && model?.kind === "image" && model.image)
      await pane.image({ image: model.image.ref }, undefined, model.tab);
    else if (inPane(current) && model?.kind === "container") {
      await control.reloadDetail();
      const files = pane.model()?.files;
      if (pane.model()?.tab === "files" && files) await pane.listFiles(files.path);
    }
    if (pane.model() || !inPane(current)) await load(back);
  };

  const cancelled =
    options.cancelled ?? ((message) => Object.assign(new Error(message), { code: "cancelled" }));
  /** @type {import("./actions.js").Deps} */
  const deps = {
    docker,
    cancel: () => runner.cancel(),
    settings: () => settings,
    selection,
    marked: () => (inPane(current) ? [] : view.marked()),
    setMarks: (items) => view.setMarks(items),
    track: (title, tracker) => pane.track(title, tracker),
    refresh,
    say,
    pick,
    expect: (id) => alerts.expect(id),
    cancelled,
  };
  const actions = {
    ...createActions(deps),
    ...createMoreActions(deps, {
      project: (name) => models.compose?.projects.find((/** @type {any} */ p) => p.name === name),
    }),
    ...createOps(deps, pane),
  };

  /** Use another context for every call, or the CLI's own with "". Kept in the plugin's store. */
  const useContext = async (/** @type {string} */ name) => {
    context = name === "" ? "" : contextName(name);
    await bridge.call("store.set", { key: CONTEXT_KEY, value: context }).catch(() => {});
    shelf.clear();
    history.clear();
    await Promise.all([watcher.stop(), stream.stop()]);
    if (await engine.probe()) watcher.start();
    wantStats();
    await load(back).catch(() => {});
    return context;
  };

  /** The view's single keys: a failure is said, never thrown at the DOM. */
  const guard = guarded(say, () => {
    said = "";
  });

  const ready = (async () => {
    // Read what a reload handed back before show() saves the state anew.
    const saved = /** @type {Saved | undefined} */ (state.get());
    settings = await loadSettings(bridge);
    all = saved?.all ?? settings.showAll;
    timestamps = settings.timestamps;
    prefs.restore(saved?.prefs);
    for (const name of QUERIED) view.prefs(name, prefs.get(name));
    const kept = await bridge.call("store.get", { key: CONTEXT_KEY }).catch(() => ({}));
    context = typeof kept.value === "string" ? kept.value : settings.context;
    const reachable = await engine.probe();
    watcher.start();
    const was = saved?.back ? (RENAMED[saved.back] ?? saved.back) : "overview";
    back = isList(was) ? /** @type {ListName} */ (was) : "overview";
    const target = saved?.logs;
    if (saved?.view === "logs" && target) await guard(control.restoreLogs)(target);
    else if (saved?.view === "inspect" && saved.detail) {
      await guard(control.inspect)({ container: saved.detail });
    } else {
      show(back);
      if (reachable) await guard(load)(back);
      else if (back === "overview") shelf.draw("overview", shelf.overviewOf({}));
    }
  })();

  return {
    ready,
    actions,
    guard,
    say,
    show,
    showList,
    load,
    refresh,
    openLogs: control.openLogs,
    tail: control.tail,
    inspect: control.inspect,
    paneTab: control.paneTab,
    reveal: control.reveal,
    shown: control.shown,
    selection,
    pane,
    prefs,
    useContext,
    pick,
    logs,
    viewOf,
    /** The focus moved between the list and the pane (a click, Tab): the keys follow it. */
    focused: (/** @type {"list" | "pane"} */ where) => {
      const model = pane.model();
      current = where === "list" || !model ? back : model.tab === "logs" ? "logs" : "inspect";
      save();
    },
    /** Close the pane and come back to the list. */
    closePane: () => {
      pane.close();
      show(back);
    },
    current: () => current,
    back: () => back,
    settings: () => settings,
    context: () => context,
    model: (/** @type {ListName} */ name) => models[name],
    stats: read,
    stop: async () => {
      live.stop();
      await Promise.all([watcher.stop(), logs.stop(), stream.stop()]);
    },
    sample: () => loaders.stats(),
    system: () => loaders.system(context),
    setAll: (/** @type {boolean} */ value) => {
      all = value;
      save();
    },
    toggleAll: () => {
      all = !all;
      save();
      return load("containers");
    },
    toggleTimestamps: () => {
      timestamps = !timestamps;
      drawLogs(logs.model());
    },
    setFilter: (/** @type {string} */ text) => {
      filter = text.trim();
      drawLogs(logs.model());
    },
    /** Set a list's query or sort, tell the view and keep it. */
    setPrefs: (/** @type {string} */ name, /** @type {Prefs} */ value) => {
      view.prefs(name, value);
      save();
      return value;
    },
    forget: (/** @type {"logs" | "inspect"} */ key) => {
      buffers.delete(key);
      control.forget(key);
      save();
    },
  };
}
