// The terminal plugin without its DOM: sessions (one program each, in a PTY the core runs), their
// output and input over the bridge's proc.*, what programs say in OSC sequences (the folder, the
// shell's marks, notifications: notices.js), a desk buffer for each, and the snapshot the surface
// comes back from after a reload. commands.js answers the plugin's commands and the desk's requests
// on top. It talks only to ctx.bridge, ctx.commands, ctx.state and a view, so the SDK's test host
// runs it with a recording view.

import { createNotices } from "./notices.js";
import { cwdOf } from "./osc.js";
import { decode, exitLine, exitText, keep } from "./output.js";
import { basename, candidates, DEFAULTS, environment, PREFIX, parseSettings } from "./shell.js";
import { blankSession, reorder, restoredSession, snapshotOf } from "./snapshot.js";
import { codeOf, scopeOf, spawnProgram } from "./spawn.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("./shell.js").Platform} Platform
 * @typedef {import("./shell.js").Settings} Settings
 * @typedef {import("./spawn.js").Program} Program
 * @typedef {import("./types.js").Session} Session
 * @typedef {import("./types.js").Snapshot} Snapshot
 * @typedef {import("./types.js").View} View
 */

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "state">} ctx
 * @param {View} view
 * @param {{ platform: Platform, snapshotMs?: number, looking?: (id: string) => boolean, now?: () => number }} options
 */
export function createTerminals({ bridge, commands, state }, view, options) {
  const { platform, snapshotMs = 250, looking = () => false, now = Date.now } = options;
  /** @type {Map<string, Session>} */
  const sessions = new Map();
  /** Process id -> the session it runs in. @type {Map<string, string>} */
  const byProc = new Map();
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
  const order = () => [...sessions.keys()];
  /** The person sees the tab: it is shown, and the frame is visible and has the focus. */
  const looks = (/** @type {string} */ id) => shown === id && looking(id);
  const notices = createNotices({
    bridge: /** @type {any} */ (bridge),
    view,
    title: (id) => sessions.get(id)?.title ?? "Terminal",
    looking: looks,
    now,
    settings: () => settings,
  });

  /** The snapshot the runtime keeps for this surface across a reload, written when things settle. */
  const snapshot = () => {
    timer = null;
    state.set(snapshotOf(next, shown, sessions.values()));
  };
  const changed = () => {
    if (timer === null) timer = setTimeout(snapshot, snapshotMs);
  };

  const name = (/** @type {Session} */ session, /** @type {string} */ title) => {
    if (title === "" || title === session.title) return;
    session.title = title;
    view.retitle(session.id, title);
    if (session.buffer) {
      commands.run("desk.buffers.update", { id: session.buffer, name: title }).catch(() => {});
    }
    changed();
  };
  /** The program set a title (OSC 0 or 2); a name the person gave the tab wins. */
  const retitle = (/** @type {string} */ id, /** @type {string} */ title) => {
    const session = held(id);
    if (!session.named) name(session, title);
  };
  /** The person names the tab; an empty name gives it back to the program. */
  const rename = (/** @type {string} */ id, /** @type {string} */ title) => {
    const session = held(id);
    const given = title.trim();
    session.named = given !== "";
    const program = session.program ?? session.programs[0];
    name(session, given || (program ? (program.title ?? basename(program.command)) : "Terminal"));
    changed();
  };

  const ended = (/** @type {Session} */ session, /** @type {string | null} */ text) => {
    if (session.ended === text) return;
    session.ended = text;
    view.end(session.id, text);
  };

  /** Start the first of the session's programs that is there; a failure is written in the terminal. */
  const launch = async (/** @type {Session} */ session) => {
    for (const [index, program] of session.programs.entries()) {
      try {
        const size = { cols: session.cols, rows: session.rows };
        const { procId } = await spawnProgram(bridge, program, {
          env: environment(settings),
          ...size,
        });
        session.program = program;
        session.procId = procId;
        session.exit = null;
        ended(session, null);
        byProc.set(procId, session.id);
        retitle(session.id, program.title ?? basename(program.command));
        changed();
        return;
      } catch (error) {
        const code = codeOf(error);
        if (code === "not_found" && index < session.programs.length - 1) continue;
        const text =
          code === "permission_denied"
            ? `Not allowed to run ${program.command}.`
            : `Could not start ${program.command}: ${code}.`;
        session.exit = text;
        view.line(session.id, text);
        ended(session, text);
        say(text);
        changed();
        return;
      }
    }
  };

  const show = (/** @type {string} */ id) => {
    held(id);
    shown = id;
    view.show(id);
    if (looking(id)) notices.seen(id);
    say("");
    changed();
  };
  const focus = (/** @type {string} */ id) => {
    view.focus(held(id).id);
    notices.seen(id);
  };

  /** Where a new terminal starts: the folder the one on screen is in (OSC 7), else the setting. */
  const folder = () => {
    const current = shown === null ? undefined : sessions.get(shown);
    return settings.newTabFolder === "current" && current?.cwd ? current.cwd : settings.cwd;
  };

  /** A new terminal: the settings' shell, or `program`. Resolves once it has started, or failed. */
  const open = async (
    /** @type {Program | undefined} */ program = undefined,
    /** @type {string | undefined} */ cwd = undefined,
  ) => {
    next += 1;
    const id = `t-${next}`;
    const where = cwd ?? folder();
    const programs = program
      ? [program]
      : candidates(platform, settings).map((p) => ({ ...p, cwd: where }));
    const first = /** @type {Program} */ (programs[0]);
    const session = blankSession(id, first.title ?? basename(first.command), programs);
    sessions.set(id, session);
    const size = view.open(id, session.title);
    session.cols = size.cols;
    session.rows = size.rows;
    show(id);
    session.buffer = await commands.run("desk.buffers.open", { name: session.title }).then(
      (buffer) => (typeof buffer === "string" ? buffer : null),
      () => null,
    );
    await launch(session);
    return session;
  };

  /** Send `signal` to the session's program; false when none runs. */
  const signal = (
    /** @type {string} */ id,
    /** @type {"term" | "kill" | "int" | "hup"} */ signal,
  ) => {
    const session = held(id);
    if (!session.procId || !session.program) return Promise.resolve(false);
    const params = { procId: session.procId, signal, scope: scopeOf(session.program.command) };
    return bridge.call("proc.kill", params).then(
      () => true,
      (error) => {
        say(`Could not signal ${session.title}: ${codeOf(error)}.`);
        return false;
      },
    );
  };

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
    view.close(id);
    if (shown === id) {
      shown = order().at(-1) ?? null;
      if (shown !== null) view.show(shown);
      else say("No terminal is open.");
    }
    changed();
    return session;
  };

  const close = (/** @type {string} */ id) => {
    const session = remove(id);
    if (session?.buffer) commands.run("desk.buffers.close", { id: session.buffer }).catch(() => {});
  };

  const restart = async (/** @type {string} */ id) => {
    const session = held(id);
    if (session.procId) {
      session.relaunch = true;
      await signal(id, "term");
      return;
    }
    view.line(id, `Starting ${session.title} again.`);
    await launch(session);
  };

  const input = (/** @type {string} */ id, /** @type {string} */ data) => {
    const session = held(id);
    if (!session.procId || !session.program) {
      if (data === "\r") void restart(id);
      return;
    }
    const params = {
      procId: session.procId,
      data,
      encoding: /** @type {const} */ ("utf8"),
      scope: scopeOf(session.program.command),
    };
    bridge
      .call("proc.write", params)
      .catch((error) => say(`Could not write to ${session.title}: ${codeOf(error)}.`));
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
    const params = { procId: session.procId, size: { cols, rows } };
    bridge
      .call("proc.resize", { ...params, scope: scopeOf(session.program.command) })
      .catch(() => {});
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
    notices.osc(id, code, data);
  };

  /** Move a tab to `index` among the tabs. */
  const move = (/** @type {string} */ id, /** @type {number} */ index) => {
    const to = reorder(sessions, id, index);
    if (to < 0) return;
    view.move(id, to);
    changed();
  };

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
    byProc.delete(event.data.procId);
    session.procId = null;
    session.exit = exitLine(session.title, event.data);
    view.line(session.id, session.exit);
    changed();
    if (session.relaunch) {
      session.relaunch = false;
      void restart(session.id);
      return;
    }
    ended(session, exitText(session.title, event.data));
    notices.exited(session.id, event.data);
  });

  /** The terminals a reload left behind: their programs still run in the core, so attach again. */
  const restore = (/** @type {Snapshot} */ saved) => {
    next = Math.max(next, saved.next);
    for (const kept of saved.sessions) {
      const programs = kept.program
        ? [kept.program]
        : candidates(platform, settings).map((p) => ({ ...p, cwd: settings.cwd }));
      const session = restoredSession(kept, programs);
      sessions.set(session.id, session);
      const size = view.open(session.id, session.title);
      for (const chunk of kept.tail) view.write(session.id, decode(chunk));
      if (session.procId) {
        byProc.set(session.procId, session.id);
        resize(session.id, size.cols, size.rows, true);
      } else if (session.exit) {
        view.line(session.id, session.exit);
        if (session.ended) view.end(session.id, session.ended);
      }
    }
    const first = saved.shown !== null && sessions.has(saved.shown) ? saved.shown : order().at(-1);
    if (first !== undefined) show(first);
  };

  return {
    /** Read the settings, then come back to the terminals a reload left, or open the first one. */
    async start() {
      const init = await bridge.call("init.get", {}).catch(() => ({ settings: {} }));
      raw = { .../** @type {Record<string, unknown>} */ (init.settings ?? {}) };
      settings = parseSettings(raw);
      const saved = /** @type {Snapshot | undefined} */ (state.get());
      if (saved?.sessions?.length) restore(saved);
      else await open();
    },
    /** One of the plugin's settings changed while it runs (its key with or without the prefix). */
    configure(/** @type {string} */ key, /** @type {unknown} */ value) {
      raw = { ...raw, [key.startsWith(PREFIX) ? key : `${PREFIX}${key}`]: value };
      settings = parseSettings(raw);
      return settings;
    },
    open,
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
      show(id);
      focus(id);
      return id;
    },
    /** The frame took the focus: the tab on screen is read. */
    attend: () => shown !== null && notices.seen(shown),
    clear: (/** @type {string} */ id) => view.clear(held(id).id),
    focus,
    shown: () => shown,
    ids: order,
    /** The session whose desk buffer this is. */
    byBuffer: (/** @type {unknown} */ buffer) =>
      [...sessions.values()].find((s) => s.buffer === buffer)?.id,
    settings: () => settings,
    sessions: () => [...sessions.values()],
  };
}
