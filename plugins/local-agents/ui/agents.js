// The controller's core: settings, which agent programs are here, the views' shared state, the
// person's choices kept between runs, and one paint of the view model at a time while answers
// stream. It talks only to ctx.bridge, ctx.commands and a view, so the SDK's test host runs it with
// a scripted program behind proc.spawn and a recording view. talk.js (chat, compare, ask) and
// tasks.js (the board) do the work on top of it.

import { createBoard } from "./board.js";
import { AGENTS, agentById } from "./catalog.js";
import { createChats } from "./chat.js";
import { detectAll, unknown } from "./detect.js";
import { viewModel } from "./model.js";
import { createRunner, systemTimers } from "./run.js";
import { createRuns } from "./runs.js";
import { DEFAULTS, inside, loadSettings } from "./settings.js";
import { load, save } from "./store.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} Ctx
 * @typedef {import("./detect.js").Status} Status
 * @typedef {import("./catalog.js").Agent} Agent
 * @typedef {"agents" | "chat" | "compare" | "board" | "activity"} ViewName
 * @typedef {import("./model.js").ViewModel} ViewModel
 * @typedef {{ render(model: ViewModel): void, say(text: string): void }} View
 * @typedef {{ id: string, label: string, detail?: string }} PickItem
 * @typedef {{ view: ViewName, chatAgent: string, compare: string[], compareRuns: string[],
 *   comparePrompt: string, card: string, run: string }} Ui
 */

/** @type {readonly ViewName[]} */
export const VIEWS = Object.freeze(["agents", "chat", "compare", "board", "activity"]);
export const PREFS_KEY = "prefs";

/**
 * @param {Pick<Ctx, "bridge" | "commands">} ctx
 * @param {View} view
 * @param {{ timers?: import("./run.js").Timers, now?(): number, flushMs?: number,
 *   cancelled?(message: string): Error, plain?: Set<string> }} [options]
 */
export function createApp(ctx, view, options = {}) {
  const { bridge, commands } = ctx;
  const timers = options.timers ?? systemTimers;
  const now = options.now ?? (() => Date.now());
  const flushMs = options.flushMs ?? 40;
  const cancelled =
    options.cancelled ??
    ((/** @type {string} */ message) => Object.assign(new Error(message), { code: "cancelled" }));
  let counter = 0;
  const id = () => `${now().toString(36)}-${(++counter).toString(36)}`;
  let settings = DEFAULTS;
  const runner = createRunner(bridge, { path: () => settings.path, timers });
  /** @type {Map<string, Status>} */
  const statuses = new Map(AGENTS.map((a) => [a.id, unknown(a)]));
  /** @type {Promise<Status[]> | undefined} */
  let detecting;
  /** @type {unknown} */
  let paintTimer;
  /** Agents the person agreed to run although nothing holds them read-only, this session. */
  const confirmed = new Set();
  const chats = createChats(bridge, { now, id });
  const board = createBoard(bridge, { now, id });
  const runs = createRuns(runner, {
    now,
    id,
    onChange: () => schedule(),
    ...(options.plain ? { plain: options.plain } : {}),
  });
  /** @type {Ui} */
  const ui = {
    view: "agents",
    chatAgent: "",
    compare: [],
    compareRuns: [],
    comparePrompt: "",
    card: "",
    run: "",
  };

  const self = {
    bridge,
    commands,
    timers,
    now,
    ui,
    chats,
    board,
    runs,
    cancelled,
    settings: () => settings,
    statuses: () => [...statuses.values()],
    status: (/** @type {string} */ agent) => statuses.get(agent),
    /** The agents found, in the catalog's order. */
    found: () => [...statuses.values()].filter((s) => s.state === "ready"),
    paint,
    schedule,
    say: (/** @type {string} */ text) => view.say(text),
    pick,
    show,
    detect,
    usable,
    question,
    keepPrefs,
    /** @type {Promise<void>} */
    ready: Promise.resolve(),
  };

  function paint() {
    if (paintTimer !== undefined) timers.clearTimeout(paintTimer);
    paintTimer = undefined;
    view.render(viewModel(self));
  }

  /** Paint soon: many stream events in a row make one paint. */
  function schedule() {
    if (flushMs === 0) return paint();
    if (paintTimer === undefined) paintTimer = timers.setTimeout(paint, flushMs);
  }

  /**
   * Ask the person through the palette: one of `items`, or (`free`) any text. Undefined when they
   * cancel.
   * @param {string} title
   * @param {PickItem[]} items
   * @param {boolean} [free]
   * @param {string} [placeholder]
   * @returns {Promise<string | undefined>}
   */
  async function pick(title, items, free = false, placeholder = "") {
    try {
      const picked = await commands.run("desk.palette.pick", {
        title,
        items,
        ...(free ? { free, placeholder } : {}),
      });
      return typeof picked === "string" ? picked : undefined;
    } catch (error) {
      if (/** @type {{ code?: string }} */ (error)?.code === "cancelled") return undefined;
      throw new Error("Cannot ask: the palette is off.");
    }
  }

  /** Show a view. */
  function show(/** @type {ViewName} */ name) {
    if (!VIEWS.includes(name)) throw new Error(`No view called ${name}: ${VIEWS.join(", ")}.`);
    ui.view = name;
    keepPrefs();
    paint();
    return name;
  }

  /** Ask every program for its version again, with the settings read again. */
  async function detect() {
    if (detecting) return detecting;
    detecting = (async () => {
      settings = await loadSettings(bridge);
      for (const agent of AGENTS) statuses.set(agent.id, unknown(agent));
      paint();
      const found = await detectAll(runner, {
        onStatus: (status) => {
          statuses.set(status.id, status);
          schedule();
        },
      });
      const ready = found.filter((s) => s.state === "ready").map((s) => s.id);
      if (!ready.includes(ui.chatAgent)) {
        const preferred = ready.includes(settings.agent) ? settings.agent : ready[0];
        if (preferred) ui.chatAgent = preferred;
      }
      if (ui.compare.length === 0 || !ui.compare.some((a) => ready.includes(a)))
        ui.compare = ready.slice(0, 4);
      if (ui.chatAgent) await chats.open(ui.chatAgent);
      paint();
      return found;
    })().finally(() => {
      detecting = undefined;
    });
    return detecting;
  }

  /**
   * The catalog entry of an agent that can run now. Waits for a detection in progress; asks once
   * before running an agent that nothing holds read-only while access is read-only.
   * @param {unknown} agentId
   * @returns {Promise<Agent>}
   */
  async function usable(agentId) {
    const agent = agentById(agentId);
    if (!agent)
      throw new Error(
        `No agent called ${String(agentId)}. The agents: ${AGENTS.map((a) => a.id).join(", ")}.`,
      );
    if (statuses.get(agent.id)?.state === "checking") await (detecting ?? detect());
    const status = statuses.get(agent.id);
    if (status?.state === "missing")
      throw new Error(`${agent.name} is not installed. Install it with: ${agent.install}`);
    if (status && status.state !== "ready")
      throw new Error(status.problem || `${agent.name} cannot run.`);
    if (
      settings.access === "read-only" &&
      settings.confirm &&
      agent.guard === "none" &&
      !confirmed.has(agent.id)
    ) {
      const picked = await pick(`${agent.name} cannot be held read-only. Run it anyway?`, [
        { id: "run", label: `Run ${agent.name}`, detail: agent.guardNote },
        { id: "cancel", label: "Do not run it" },
      ]);
      if (picked !== "run") throw cancelled(`${agent.name} was not run.`);
      confirmed.add(agent.id);
    }
    return agent;
  }

  /**
   * A question as the settings say: read-only or not, the folder (or `folder` inside it), the time
   * it may take.
   * @param {Agent} agent
   * @param {string} prompt
   * @param {Partial<import("./ask.js").Question> & { folder?: unknown }} [extra]
   * @returns {import("./ask.js").Question}
   */
  function question(agent, prompt, extra = {}) {
    const { folder, ...rest } = extra;
    const cwd = folder === undefined ? settings.folder : inside(settings.folder, folder);
    return {
      agent,
      prompt,
      readOnly: settings.access === "read-only",
      ...(cwd ? { cwd } : {}),
      timeoutMs: settings.timeout * 1000,
      ...rest,
    };
  }

  function keepPrefs() {
    void save(bridge, PREFS_KEY, { view: ui.view, chatAgent: ui.chatAgent, compare: ui.compare });
  }

  self.ready = (async () => {
    const prefs = /** @type {Partial<Ui> | undefined} */ (await load(bridge, PREFS_KEY));
    if (prefs && VIEWS.includes(/** @type {ViewName} */ (prefs.view)))
      ui.view = /** @type {ViewName} */ (prefs.view);
    if (agentById(prefs?.chatAgent)) ui.chatAgent = /** @type {string} */ (prefs?.chatAgent);
    if (Array.isArray(prefs?.compare)) ui.compare = prefs.compare.filter((a) => agentById(a));
    await board.ready;
    paint();
    await detect();
  })();

  return self;
}

/** @typedef {ReturnType<typeof createApp>} App */
