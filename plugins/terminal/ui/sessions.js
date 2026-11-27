// Terminal sessions, PTY I/O, split layout, shell integration, and desk buffers.
import { createKeeper, whereOf } from "./keep.js";
import { createLaunch } from "./launch.js";
import { createNames, programName } from "./names.js";
import { createNotices } from "./notices.js";
import { cwdOf } from "./osc.js";
import { decode, exitText, keep } from "./output.js";
import { createTabSet } from "./panes.js";
import { createPipes } from "./pipe.js";
import { createRestore } from "./restore.js";
import { createSessionProtection } from "./session-protection.js";
import { candidates, DEFAULTS, PREFIX, parseSettings } from "./shell.js";
import { blankSession } from "./snapshot.js";
import { scopeOf } from "./spawn.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("./shell.js").Platform} Platform
 * @typedef {import("./shell.js").Settings} Settings
 * @typedef {import("./spawn.js").Program} Program
 * @typedef {import("./types.js").Session} Session
 * @typedef {import("./types.js").Snapshot} Snapshot
 * @typedef {import("./types.js").View} View
 * @typedef {import("./layout.js").Split} Split
 * @typedef {import("./layout.js").Direction} Direction
 */

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "state" | "surface">} ctx
 * @param {View} view
 * @param {{ platform: Platform, snapshotMs?: number, looking?: (id: string) => boolean, now?: () => number }} options
 */
export function createTerminals({ bridge, commands, state, surface }, view, options) {
  const { platform, snapshotMs = 250, looking = () => false, now = Date.now } = options;
  /** @type {Map<string, Session>} */
  const sessions = new Map();
  /** Process id -> the session it runs in. @type {Map<string, string>} */
  const byProc = new Map();
  /** The tabs, each a split layout of sessions (panes). */
  const tabset = createTabSet();
  /** @type {Settings} */
  let settings = { ...DEFAULTS };
  /** The settings as init.get and settings.changed name them (`endue.terminal.*`). */
  let raw = /** @type {Record<string, unknown>} */ ({});
  /** @type {string | null} */
  let shown = null;
  let next = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let said = "";

  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.status(text);
  };
  const held = (/** @type {string} */ id) => {
    const session = sessions.get(id);
    if (!session) throw new Error(`No terminal ${id}.`);
    return session;
  };
  /** The sessions tab by tab, each tab's panes in layout order. */
  const order = () => tabset.panes();
  /** The person sees the tab: it is shown, and the frame is visible and has the focus. */
  const looks = (/** @type {string} */ id) => shown === id && looking(id);
  const notices = createNotices({
    bridge: /** @type {any} */ (bridge),
    ...{ view, commands, say },
    title: (id) => sessions.get(id)?.title ?? "Terminal",
    looking: looks,
    now,
    settings: () => settings,
  });

  const keeper = createKeeper({ state, bridge });
  /** The reload snapshot and the layout kept for a restart, written when things settle (keep.js). */
  const snapshot = () => {
    timer = null;
    keeper.write(next, shown, tabset, held);
  };
  const changed = () => {
    if (timer === null) timer = setTimeout(snapshot, snapshotMs);
  };

  const protection = createSessionProtection(commands, changed);
  const { retitle, rename } = createNames({ view, commands, sessions, held, changed });

  const { ended, launch, signal } = createLaunch({
    bridge,
    view,
    held,
    byProc,
    sessions,
    settings: () => settings,
    retitle,
    say,
    changed,
    started: protection.reset,
  });

  const show = (/** @type {string} */ id) => {
    held(id);
    shown = id;
    tabset.focus(id);
    view.show(id);
    if (looking(id)) notices.seen(id);
    say("");
    changed();
  };
  const focus = (/** @type {string} */ id) => {
    view.focus(held(id).id);
    notices.seen(id);
  };
  /** A command brings the tab to the person: shown, with the keys, its window in front (#160). */
  const present = (/** @type {string} */ id) => {
    if (shown !== id) show(id);
    focus(id);
    surface.show();
  };

  /** A desk buffer for the session, renamed with it (names.js). */
  const buffer = async (/** @type {Session} */ session) => {
    session.buffer = await commands.run("desk.buffers.open", { name: session.title }).then(
      (b) => (typeof b === "string" ? b : null),
      () => null,
    );
    protection.sync(session);
  };

  /** Where a new terminal starts: the folder the one on screen is in (OSC 7), else the setting. */
  const folder = () => {
    const current = shown === null ? undefined : sessions.get(shown);
    return settings.newTabFolder === "current" && current?.cwd ? current.cwd : settings.cwd;
  };

  /** Open `program` or the configured shell in a new tab or beside a pane, then await the spawn. */
  const open = async (
    /** @type {Program | undefined} */ program = undefined,
    /** @type {string | undefined} */ cwd = undefined,
    /** @type {{ beside: string, direction: Split } | undefined} */ place = undefined,
    /** @type {string | undefined} */ invocationId = undefined,
  ) => {
    next += 1;
    const id = `t-${next}`;
    const where = cwd ?? folder();
    const programs = program
      ? [program]
      : candidates(platform, settings).map((p) => ({ ...p, cwd: where }));
    const session = blankSession(id, programName(programs[0], sessions.values(), id), programs);
    sessions.set(id, session);
    const tab = (place && tabset.split(place.beside, place.direction, id)) ?? tabset.add(id);
    const size = view.open(id, session.title, tab.id);
    session.cols = size.cols;
    session.rows = size.rows;
    view.layout(tab.id, tab.layout);
    show(id);
    await buffer(session);
    await launch(session, invocationId);
    return session;
  };

  /** A shell beside the pane `id`, in its folder, in its tab. */
  const split = (/** @type {string} */ id, /** @type {Split} */ direction) =>
    open(undefined, whereOf(held(id)) ?? undefined, { beside: id, direction });

  /** Forget a session: its program gets a hang-up, as when a terminal window closes. */
  const remove = (/** @type {string} */ id) => {
    const session = sessions.get(id);
    if (!session) return undefined;
    if (session.procId) {
      void signal(id, "hup");
      byProc.delete(session.procId);
    }
    sessions.delete(id);
    notices.forget(id);
    const left = tabset.remove(id);
    view.close(id);
    if (left && !left.closed) view.layout(left.tab.id, left.tab.layout);
    if (shown === id) {
      // The pane beside it in its tab, else the last tab's pane in use.
      shown = left && !left.closed ? left.tab.focused : (tabset.all().at(-1)?.focused ?? null);
      if (shown !== null) view.show(shown);
      else say("No terminal is open.");
    }
    changed();
    return session;
  };

  const { close, restart } = protection.lifecycle({
    sessions,
    remove,
    signal,
    launch,
    line: (id, text) => view.line(id, text),
  });

  const input = (/** @type {string} */ id, /** @type {import("./pipe.js").Input} */ data) => {
    const session = held(id);
    if (!session.procId || !session.program) {
      if (data === "\r") void restart(id);
      return;
    }
    protection.input(session, data);
    pipes.write(session.procId, scopeOf(session.program.command), data);
  };

  /** The view's size reached the PTY; `again` sends it even when it did not change (a reload). */
  const resize = (
    /** @type {string} */ id,
    /** @type {number} */ cols,
    /** @type {number} */ rows,
    again = false,
  ) => {
    const session = held(id);
    if (!again && session.cols === cols && session.rows === rows) return;
    session.cols = cols;
    session.rows = rows;
    if (!session.procId || !session.program) return;
    pipes.resize(session.procId, scopeOf(session.program.command), { cols, rows });
  };

  /** What a program said in an OSC sequence the view handed over (osc.js has the codes). */
  const osc = (
    /** @type {string} */ id,
    /** @type {number} */ code,
    /** @type {string} */ data,
  ) => {
    const session = sessions.get(id);
    if (!session) return;
    const cwd = cwdOf(code, data);
    if (cwd && cwd !== session.cwd) {
      session.cwd = cwd;
      changed();
    }
    protection.osc(session, code, data);
    notices.osc(id, code, data);
  };

  /** Move the tab `id` is in to `index` among the tabs. */
  const move = (/** @type {string} */ id, /** @type {number} */ index) => {
    const tab = tabset.tabOf(id);
    const to = tab ? tabset.move(tab.id, index) : -1;
    if (!tab || to < 0) return;
    view.move(tab.id, to);
    changed();
  };

  /** The focus to the pane beside the one on screen, on `direction`'s side; the pane it is on. */
  const focusPane = (/** @type {Direction} */ direction) => {
    if (shown === null) throw new Error("No terminal is open.");
    const id = tabset.neighbour(shown, direction);
    present(id);
    return id;
  };

  /** A divider of `tab` dragged to `ratio` of its split, no pane smaller than `min` (layout.js). */
  const ratio = (
    /** @type {string} */ tab,
    /** @type {string} */ path,
    /** @type {number} */ value,
    /** @type {import("./layout.js").Min} */ min,
  ) => {
    const t = tabset.ratio(tab, path, value, min);
    if (!t) return;
    view.layout(t.id, t.layout);
    changed();
  };

  /**
   * The program ended: its exit came, or a call was answered `not_found` (it ended unheard, say
   * while the window was closed). The banner says how; a restart writes it in the text.
   */
  const exited = (
    /** @type {Session} */ session,
    /** @type {import("@endue-ai/bridge").ProcExitData} */ exit,
  ) => {
    if (session.procId !== exit.procId) return;
    byProc.delete(exit.procId);
    pipes.drop(exit.procId);
    session.procId = null;
    protection.reset(session);
    session.exit = exitText(session.title, exit);
    changed();
    if (session.relaunch) {
      session.relaunch = false;
      void restart(session.id);
      return;
    }
    ended(session, session.exit);
    notices.exited(session.id, exit);
  };
  const pipes = createPipes(bridge, (procId, method, code) => {
    const session = sessions.get(byProc.get(procId) ?? "");
    if (!session) return;
    if (code === "not_found") exited(session, { procId });
    else if (method === "proc.write") say(`Could not write to ${session.title}: ${code}.`);
  });

  bridge.onEvent((/** @type {BridgeEvent} */ event) => {
    if (event.event !== "proc.output" && event.event !== "proc.exit") return;
    const id = byProc.get(event.data.procId);
    const session = id === undefined ? undefined : sessions.get(id);
    if (!session) return;
    if (event.event === "proc.output") {
      const chunk = { data: event.data.data, encoding: event.data.encoding };
      keep(session, chunk);
      view.write(session.id, decode(chunk));
      changed();
      return;
    }
    exited(session, event.data);
  });

  const restoring = createRestore({
    bridge: /** @type {any} */ (bridge),
    sessions,
    byProc,
    tabset,
    view,
    platform,
    settings: () => settings,
    id: () => {
      next += 1;
      return `t-${next}`;
    },
    seen: (n) => {
      next = Math.max(next, n);
    },
    resize,
    show,
    buffer,
    launch,
    sync: (session) => protection.sync(session, true),
  });

  return {
    /** Read the settings, then come back to the terminals a reload left, or open the first one. */
    async start() {
      const init = await bridge.call("init.get", {}).catch(() => ({ settings: {} }));
      raw = { .../** @type {Record<string, unknown>} */ (init.settings ?? {}) };
      settings = parseSettings(raw);
      await restoring.begin(/** @type {Snapshot | undefined} */ (state.get()), () => open());
    },
    /** One of the plugin's settings changed while it runs (its key with or without the prefix). */
    configure(/** @type {string} */ key, /** @type {unknown} */ value) {
      raw = { ...raw, [key.startsWith(PREFIX) ? key : `${PREFIX}${key}`]: value };
      settings = parseSettings(raw);
      return settings;
    },
    open,
    split,
    focusPane,
    ratio,
    /** The tabs in order, each with its layout and its pane in use. */
    tabs: () => tabset.all().map(({ id, layout, focused }) => ({ id, layout, focused })),
    show,
    close,
    remove,
    restart,
    signal,
    input,
    resize,
    retitle,
    rename,
    move,
    osc,
    bell: (/** @type {string} */ id) => notices.bell(held(id).id),
    /** The tab a desk notification came from, shown and focused; null when it is gone. */
    openNotice(/** @type {unknown} */ notificationId) {
      const id = notices.open(notificationId);
      if (id === undefined || !sessions.has(id)) return null;
      present(id);
      return id;
    },
    /** The frame took the focus: the tab on screen is read. */
    attend: () => shown !== null && notices.seen(shown),
    clear: (/** @type {string} */ id) => view.clear(held(id).id),
    focus,
    present,
    shown: () => shown,
    ids: order,
    /** The session whose desk buffer this is. */
    byBuffer: (/** @type {unknown} */ buffer) =>
      [...sessions.values()].find((s) => s.buffer === buffer)?.id,
    settings: () => settings,
    sessions: () => [...sessions.values()],
  };
}
