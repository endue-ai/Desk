// The terminal plugin without its DOM: sessions (one program each, in a PTY the core runs), their
// output and input over the bridge's proc.*, a desk buffer for each, and the snapshot the surface
// comes back from after a reload. commands.js answers the plugin's commands and the desk's requests
// on top. It talks only to ctx.bridge, ctx.commands, ctx.state and a view, so the SDK's test host
// runs it with a recording view.

import { decode, exitLine, keep, tailOf } from "./output.js";
import { basename, candidates, DEFAULTS, environment, parseSettings } from "./shell.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("./shell.js").Platform} Platform
 * @typedef {import("./shell.js").Settings} Settings
 * @typedef {{ command: string, args: string[], cwd: string, title?: string }} Program
 * @typedef {import("./output.js").Chunk} Chunk
 * @typedef {{
 *   id: string, title: string, programs: Program[], program: Program | null, procId: string | null,
 *   buffer: string | null, cols: number, rows: number, exit: string | null, chunks: Chunk[],
 *   kept: number, relaunch: boolean,
 * }} Session
 * @typedef {Pick<Session, "id" | "title" | "program" | "procId" | "buffer" | "exit"> & { tail: Chunk[] }} Saved
 * @typedef {{ next: number, shown: string | null, sessions: Saved[] }} Snapshot
 * @typedef {{
 *   open(id: string, title: string): { cols: number, rows: number },
 *   write(id: string, data: string | Uint8Array): void,
 *   line(id: string, text: string): void,
 *   show(id: string): void,
 *   close(id: string): void,
 *   clear(id: string): void,
 *   retitle(id: string, title: string): void,
 *   focus(id: string): void,
 *   status(text: string): void,
 * }} View
 */

const FALLBACK_SIZE = { cols: 80, rows: 24 };

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

const scopeOf = (/** @type {string} */ command) =>
  /** @type {const} */ ({ permission: "proc:spawn", commands: [command], pty: true });

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "state">} ctx
 * @param {View} view
 * @param {{ platform: Platform, snapshotMs?: number }} options
 */
export function createTerminals({ bridge, commands, state }, view, { platform, snapshotMs = 250 }) {
  /** @type {Map<string, Session>} */
  const sessions = new Map();
  /** Process id -> the session it runs in. @type {Map<string, string>} */
  const byProc = new Map();
  /** @type {Settings} */
  let settings = { ...DEFAULTS };
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

  /** The snapshot the runtime keeps for this surface across a reload, written when things settle. */
  const snapshot = () => {
    timer = null;
    /** @type {Snapshot} */
    const saved = {
      next,
      shown,
      sessions: [...sessions.values()].map(
        ({ id, title, program, procId, buffer, exit, chunks }) => ({
          id,
          title,
          program,
          procId,
          buffer,
          exit,
          tail: chunks,
        }),
      ),
    };
    state.set(saved);
  };
  const changed = () => {
    if (timer === null) timer = setTimeout(snapshot, snapshotMs);
  };

  const retitle = (/** @type {string} */ id, /** @type {string} */ title) => {
    const session = held(id);
    if (title === "" || title === session.title) return;
    session.title = title;
    view.retitle(id, title);
    if (session.buffer) {
      commands.run("desk.buffers.update", { id: session.buffer, name: title }).catch(() => {});
    }
    changed();
  };

  /** proc.spawn, asking once when the grants do not cover the program. */
  const spawn = async (/** @type {Session} */ session, /** @type {Program} */ program) => {
    const scope = scopeOf(program.command);
    const params = {
      command: program.command,
      args: program.args,
      cwd: program.cwd,
      env: environment(settings),
      pty: { cols: session.cols, rows: session.rows },
      scope,
    };
    try {
      return await bridge.call("proc.spawn", params);
    } catch (error) {
      if (codeOf(error) !== "permission_denied") throw error;
    }
    const reason = `To run ${program.command} in a terminal`;
    const asked = await bridge
      .call("perm.request", { permission: scope, reason })
      .catch(() => ({ granted: false }));
    if (!asked.granted) throw Object.assign(new Error("refused"), { code: "permission_denied" });
    return bridge.call("proc.spawn", params);
  };

  /** Start the first of the session's programs that is there; a failure is written in the terminal. */
  const launch = async (/** @type {Session} */ session) => {
    for (const [index, program] of session.programs.entries()) {
      try {
        const { procId } = await spawn(session, program);
        session.program = program;
        session.procId = procId;
        session.exit = null;
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
    say("");
    changed();
  };

  /** A new terminal: the settings' shell, or `program`. Resolves once it has started, or failed. */
  const open = async (
    /** @type {Program} */ program = undefined,
    /** @type {string} */ cwd = settings.cwd,
  ) => {
    next += 1;
    const id = `t-${next}`;
    const programs = program
      ? [program]
      : candidates(platform, settings).map((p) => ({ ...p, cwd }));
    const first = /** @type {Program} */ (programs[0]);
    /** @type {Session} */
    const session = {
      id,
      title: first.title ?? basename(first.command),
      programs,
      program: null,
      procId: null,
      buffer: null,
      ...FALLBACK_SIZE,
      exit: null,
      ...tailOf(),
      relaunch: false,
    };
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

  const resize = (
    /** @type {string} */ id,
    /** @type {number} */ cols,
    /** @type {number} */ rows,
  ) => {
    const session = held(id);
    session.cols = cols;
    session.rows = rows;
    if (!session.procId || !session.program) return;
    const params = {
      procId: session.procId,
      size: { cols, rows },
      scope: scopeOf(session.program.command),
    };
    bridge.call("proc.resize", params).catch(() => {});
  };

  const bell = (/** @type {string} */ id) => {
    const session = held(id);
    if (settings.bell !== "notify") return;
    const params = {
      title: "Terminal",
      body: `${session.title} rang the bell.`,
      level: /** @type {const} */ ("info"),
      scope: { permission: /** @type {const} */ ("ui:notify") },
    };
    bridge.call("ui.notify", params).catch(() => {});
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
    }
  });

  /** The terminals a reload left behind: their programs still run in the core, so attach again. */
  const restore = (/** @type {Snapshot} */ saved) => {
    next = Math.max(next, saved.next);
    for (const kept of saved.sessions) {
      const { tail, ...rest } = kept;
      /** @type {Session} */
      const session = {
        ...rest,
        programs: kept.program
          ? [kept.program]
          : candidates(platform, settings).map((p) => ({ ...p, cwd: settings.cwd })),
        ...FALLBACK_SIZE,
        ...tailOf(tail),
        relaunch: false,
      };
      sessions.set(session.id, session);
      const size = view.open(session.id, session.title);
      for (const chunk of tail) view.write(session.id, decode(chunk));
      if (session.procId) {
        byProc.set(session.procId, session.id);
        resize(session.id, size.cols, size.rows);
      } else if (session.exit) {
        view.line(session.id, session.exit);
      }
    }
    const first = saved.shown !== null && sessions.has(saved.shown) ? saved.shown : order().at(-1);
    if (first !== undefined) show(first);
  };

  return {
    /** Read the settings, then come back to the terminals a reload left, or open the first one. */
    async start() {
      const init = await bridge.call("init.get", {}).catch(() => ({ settings: {} }));
      settings = parseSettings(/** @type {Record<string, unknown>} */ (init.settings ?? {}));
      const saved = /** @type {Snapshot | undefined} */ (state.get());
      if (saved?.sessions?.length) restore(saved);
      else await open();
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
    bell,
    clear: (/** @type {string} */ id) => view.clear(held(id).id),
    focus: (/** @type {string} */ id) => view.focus(held(id).id),
    shown: () => shown,
    ids: order,
    /** The session whose desk buffer this is. */
    byBuffer: (/** @type {unknown} */ buffer) =>
      [...sessions.values()].find((s) => s.buffer === buffer)?.id,
    settings: () => settings,
    sessions: () => [...sessions.values()],
  };
}
