// The Docker plugin without its DOM: the engine it talks to (context, versions, what is wrong), the
// lists and which one is on screen, the logs and detail views as desk buffers, and the live updates
// (live.js, watch.js) that keep it all current. commands.js answers the plugin's commands on top.
// It talks only to ctx.bridge, ctx.commands, ctx.state and a view, so the SDK's test host runs it
// with a recording view and a scripted docker.

import { createActions } from "./actions.js";
import { createMoreActions } from "./actions-more.js";
import { createDesk, guarded } from "./desk.js";
import { createEngine } from "./engine.js";
import { firstOf, inspectModel } from "./inspect.js";
import { hints, LISTS } from "./keys.js";
import { createLoaders } from "./lists.js";
import { createLive } from "./live.js";
import { createLogs, readLogs, titleOf } from "./logs.js";
import { containerTarget, contextName, logTarget } from "./refs.js";
import { createRunner } from "./run.js";
import { DEFAULTS, loadSettings } from "./settings.js";
import { createAlerts, createWatcher } from "./watch.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("./keys.js").ViewName} ViewName
 * @typedef {(typeof LISTS)[number]} ListName
 * @typedef {import("./actions.js").Item} Item
 * @typedef {import("./logs.js").LogTarget} LogTarget
 * @typedef {import("./logs.js").LogModel} LogModel
 * @typedef {import("./inspect.js").Detail} Detail
 * @typedef {import("./watch.js").Clock} Clock
 * @typedef {import("./engine.js").Header} Header
 * @typedef {LogModel & { timestamps: boolean, filter: string }} LogsView
 * @typedef {{
 *   header(header: Header): void,
 *   show(view: ViewName, hints: string): void,
 *   list(view: ListName, model: unknown): void,
 *   logs(model: LogsView): void,
 *   detail(model: Detail | null): void,
 *   say(text: string): void,
 *   busy(running: number): void,
 *   focus(): void,
 *   selection(): Item | undefined,
 * }} View
 * @typedef {{ view?: ViewName, back?: ListName, all?: boolean, logs?: LogTarget | null, detail?: string | null }} Saved
 * @typedef {{ runner?: ReturnType<typeof createRunner>, clock?: Clock, flushMs?: number,
 *   cancelled?(message: string): Error }} Options
 */

const CONTEXT_KEY = "context";
const isList = (/** @type {string} */ name) =>
  /** @type {readonly string[]} */ (LISTS).includes(name);

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "state">} ctx
 * @param {View} view
 * @param {Options} [options] `cancelled` makes the error a cancelled command answers with.
 */
export function createDocker({ bridge, commands, state }, view, options = {}) {
  const clock = options.clock ?? { setTimeout, clearTimeout, now: () => Date.now() };
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
  let current = "containers";
  /** The list `q` goes back to from logs or a detail. @type {ListName} */
  let back = "containers";
  let all = true;
  /** @type {Partial<Record<ListName, any>>} */
  const models = {};
  /** @type {Detail | null} */
  let detail = null;
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
  /** @type {Partial<Record<ListName, number>>} */
  const loads = {};
  /** Read a list and draw it, unless a newer read of the same list came back first. */
  const load = async (/** @type {ListName} */ name) => {
    const mine = (loads[name] ?? 0) + 1;
    loads[name] = mine;
    const model =
      name === "containers"
        ? { ...(await loaders.containers(all)), stats: models.containers?.stats ?? new Map() }
        : name === "system"
          ? await loaders.system(context)
          : await loaders[name]();
    if (mine !== loads[name]) return models[name];
    models[name] = model;
    engine.ok();
    view.list(name, model);
    if (name === "containers") live.scheduleStats(true);
    return model;
  };

  const loadDetail = async (/** @type {string} */ ref) => {
    const { stdout } = await docker(["container", "inspect", "--", ref]);
    const json = firstOf(stdout);
    if (!json) throw new Error(`docker said nothing about ${ref}.`);
    detail = inspectModel(json, { reveal: settings.revealEnv });
    view.detail(detail);
    return detail;
  };

  /** Read the detail on screen again; when its container is gone, go back to the list. */
  const reloadDetail = async () => {
    if (!detail) return;
    const { id, name } = detail;
    try {
      await loadDetail(id);
    } catch (error) {
      if (!/no such container/i.test(messageOf(error))) throw error;
      detail = null;
      view.detail(null);
      if (current === "inspect") await showList(back);
      say(`${name} is gone.`);
    }
  };

  const live = createLive({
    clock,
    current: () => current,
    interval: () => settings.statsInterval,
    anyRunning: () =>
      models.containers?.containers.some((/** @type {any} */ c) => c.state === "running") ?? false,
    sample: () => loaders.stats(),
    sampled: (stats) => {
      if (!models.containers) return;
      models.containers = { ...models.containers, stats };
      if (current === "containers") view.list("containers", models.containers);
    },
    load,
    forget: (name) => delete models[name],
    detailId: () => detail?.id,
    reloadDetail,
    failed: (error) => say(messageOf(error)),
  });
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
    state.set({ view: current, back, all, logs: logs.model().target, detail: detail?.id ?? null });

  const show = (/** @type {ViewName} */ name) => {
    current = name;
    if (isList(name)) back = /** @type {ListName} */ (name);
    view.show(name, hints(name));
    view.focus();
    save();
    live.scheduleStats(true);
  };

  /** Show a list, read fresh. */
  const showList = async (/** @type {ListName} */ name) => {
    show(name);
    return load(name);
  };

  /** The detail on screen, which commands fall back to when nothing is selected. */
  const shown = () => (current === "inspect" ? detail : null);

  /** @param {Record<string, unknown>} [args] `follow` and `tail` override the settings. */
  const openLogs = async (args = {}) => {
    const target = logTarget(args, view.selection(), shown());
    const follow = typeof args.follow === "boolean" ? args.follow : settings.follow;
    const tail = Number.isInteger(args.tail) ? Number(args.tail) : settings.logTail;
    filter = "";
    await buffer("logs", titleOf(target));
    show("logs");
    await logs.open(target, { follow, tail });
    save();
    return { title: titleOf(target), follow };
  };

  /** The last lines of a target's logs, for agents: no view, both streams in time order. */
  const tail = async (/** @type {Record<string, unknown>} */ args = {}) => ({
    lines: await readLogs({ run: docker }, logTarget(args, view.selection(), shown()), args),
  });

  /** @param {Record<string, unknown>} [args] */
  const inspect = async (args = {}) => {
    const { ref } = containerTarget(args, view.selection(), shown());
    const model = await loadDetail(ref);
    await buffer("inspect", `docker inspect: ${model.name}`);
    show("inspect");
    return model;
  };

  /** Refresh what is on screen: a list, the detail, or the logs from their tail again. */
  const refresh = async () => {
    if (current === "inspect") await reloadDetail();
    else if (current === "logs") {
      const { target, follow } = logs.model();
      if (target) await logs.open(target, { follow });
    } else await load(/** @type {ListName} */ (current));
  };

  const cancelled =
    options.cancelled ?? ((message) => Object.assign(new Error(message), { code: "cancelled" }));
  /** What actions work on: the row under the cursor, or in a detail the container it shows. */
  const selection = () =>
    current === "inspect" && detail
      ? {
          kind: /** @type {const} */ ("container"),
          id: detail.id,
          name: detail.name,
          state: detail.state,
          project: "",
        }
      : view.selection();
  /** @type {import("./actions.js").Deps} */
  const deps = {
    docker,
    cancel: () => runner.cancel(),
    settings: () => settings,
    selection,
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
  };

  /** Use another context for every call, or the CLI's own with "". Kept in the plugin's store. */
  const useContext = async (/** @type {string} */ name) => {
    context = name === "" ? "" : contextName(name);
    await bridge.call("store.set", { key: CONTEXT_KEY, value: context }).catch(() => {});
    for (const key of Object.keys(models)) delete models[/** @type {ListName} */ (key)];
    await watcher.stop();
    if (await engine.probe()) watcher.start();
    if (isList(current)) await load(/** @type {ListName} */ (current)).catch(() => {});
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
    const kept = await bridge.call("store.get", { key: CONTEXT_KEY }).catch(() => ({}));
    context = typeof kept.value === "string" ? kept.value : settings.context;
    const reachable = await engine.probe();
    watcher.start();
    back = saved?.back && isList(saved.back) ? saved.back : "containers";
    const target = saved?.logs;
    if (saved?.view === "logs" && target) {
      const args = target.kind === "project" ? { project: target.name } : { container: target.id };
      await guard(openLogs)(args);
    } else if (saved?.view === "inspect" && saved.detail) {
      await guard(inspect)({ container: saved.detail });
    } else {
      show(back);
      if (reachable) await guard(load)(back);
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
    openLogs,
    tail,
    inspect,
    useContext,
    pick,
    logs,
    viewOf,
    /** Show a buffer the desk asked for; one with nothing left in it shows the list instead. */
    reveal: async (/** @type {"logs" | "inspect"} */ key) => {
      if (key === "inspect" ? !detail : !logs.model().target) await showList(back);
      else show(key);
    },
    current: () => current,
    back: () => back,
    settings: () => settings,
    context: () => context,
    shown,
    model: (/** @type {ListName} */ name) => models[name],
    stop: async () => {
      live.stop();
      await Promise.all([watcher.stop(), logs.stop()]);
    },
    stats: () => loaders.stats(),
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
    forget: (/** @type {"logs" | "inspect"} */ key) => {
      buffers.delete(key);
      if (key === "logs") void logs.stop();
      else {
        detail = null;
        view.detail(null);
      }
      save();
    },
  };
}

const messageOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);
