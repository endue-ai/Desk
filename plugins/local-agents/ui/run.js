// Runs agent programs through the bridge: `proc.spawn` without a shell, output read line by line
// from `proc.output` events by process id until `proc.exit`, a timeout and a stop that kill, the
// usual install folders tried once when the desk's PATH misses a program, and one ask with
// `perm.request` when the grant is missing. Every failure is an AgentError whose message is the
// sentence the person reads.

import { COMMANDS } from "./catalog.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginBridge} PluginBridge
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {"stdout" | "stderr"} Stream
 * @typedef {{ code: number | null, signal: string | null, stderr: string, timedOut: boolean, stopped: boolean }} Outcome
 * @typedef {{ cwd?: string, timeoutMs?: number, onLine(stream: Stream, line: string): void }} StartOptions
 * @typedef {{ procId: string, done: Promise<Outcome>, stop(): Promise<void> }} Handle
 * @typedef {{ setTimeout(fn: () => void, ms: number): unknown, clearTimeout(id: unknown): void }} Timers
 */

/** The scope every call carries: the catalog's programs, no PTY. One grant covers them all. */
export const SCOPE = Object.freeze({ permission: "proc:spawn", commands: COMMANDS });

/** No colours and no spinners: the plugin reads the output, a terminal does not. */
export const AGENT_ENV = Object.freeze({ NO_COLOR: "1", FORCE_COLOR: "0" });

/**
 * Where agent programs and the node they run on are installed when the desk's own PATH misses them
 * (an app started from the Finder gets the system's PATH, not the shell's). Tried once per program.
 */
export const FALLBACK_PATH = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/snap/bin",
  "/home/linuxbrew/.linuxbrew/bin",
].join(":");

const STDERR_KEPT = 20;
const LINE_LIMIT = 256 * 1024;
const EARLY_PROCS = 32;

/** A program could not run, or ended badly; `kind` says which for the views. */
export class AgentError extends Error {
  /**
   * @param {string} message
   * @param {{ kind?: "missing" | "unsupported" | "denied" | "failed" | "timeout" | "stopped", outcome?: Outcome }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = "AgentError";
    this.kind = options.kind ?? "failed";
    this.outcome = options.outcome;
  }
}

/** The platform's timers, called as functions (a browser refuses any other `this`). */
export const systemTimers = /** @type {Timers} */ ({
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(/** @type {any} */ (id)),
});

/**
 * @param {Pick<PluginBridge, "call" | "onEvent">} bridge
 * @param {{ path?(): string, timers?: Timers }} [options] `path`: the PATH programs are looked up
 *   on and run with; "" keeps the desk's.
 */
export function createRunner(bridge, options = {}) {
  const path = options.path ?? (() => "");
  const timers = options.timers ?? systemTimers;
  /** Programs found only on FALLBACK_PATH. */
  const fallback = new Set();
  /** @type {Map<string, (event: BridgeEvent) => void>} */
  const jobs = new Map();
  /** Events for processes whose spawn answer has not arrived yet. @type {Map<string, BridgeEvent[]>} */
  const early = new Map();
  /** The ask in flight, which spawns refused at the same time share. @type {Promise<boolean> | undefined} */
  let asking;

  bridge.onEvent((event) => {
    if (event.event !== "proc.output" && event.event !== "proc.exit") return;
    const feed = jobs.get(event.data.procId);
    if (feed) return feed(event);
    const kept = early.get(event.data.procId) ?? [];
    kept.push(event);
    early.set(event.data.procId, kept);
    const oldest = early.keys().next().value;
    if (early.size > EARLY_PROCS && oldest !== undefined) early.delete(oldest);
  });

  const scope = () => ({ ...SCOPE, commands: [...SCOPE.commands] });

  /**
   * Start `command` once; on not_found try the install folders, on a missing grant ask once.
   * @param {string} command
   * @param {string[]} args
   * @param {string | undefined} cwd
   * @returns {Promise<{ procId: string }>}
   */
  const spawn = async (command, args, cwd) => {
    const chosen = path() || (fallback.has(command) ? FALLBACK_PATH : "");
    const params = {
      command,
      args,
      ...(cwd ? { cwd } : {}),
      env: { ...AGENT_ENV, ...(chosen ? { PATH: chosen } : {}) },
      scope: scope(),
    };
    const refused = (/** @type {unknown} */ error) => {
      const code = codeOf(error);
      if (code === "unsupported")
        return new AgentError("This desk cannot run programs yet: proc.spawn is unsupported.", {
          kind: "unsupported",
        });
      if (code === "not_found")
        return new AgentError(
          `${command} is not on PATH: install it, or set endue.local-agents.path to the folders it is in.`,
          { kind: "missing" },
        );
      if (code === "permission_denied")
        return new AgentError(`Not allowed to run ${command}.`, { kind: "denied" });
      return new AgentError(`Could not run ${command}: ${messageOf(error) || code}.`);
    };
    try {
      return await bridge.call("proc.spawn", params);
    } catch (error) {
      if (codeOf(error) === "not_found" && !chosen) {
        const found = await bridge
          .call("proc.spawn", { ...params, env: { ...params.env, PATH: FALLBACK_PATH } })
          .catch(() => undefined);
        if (found) {
          fallback.add(command);
          return found;
        }
      }
      if (codeOf(error) !== "permission_denied") throw refused(error);
    }
    asking ??= bridge
      .call("perm.request", {
        permission: scope(),
        reason: `To find and run the agent programs on this computer (${COMMANDS.join(", ")})`,
      })
      .then((decision) => decision.granted === true)
      .catch(() => false)
      .finally(() => {
        asking = undefined;
      });
    if (!(await asking))
      throw new AgentError("Not allowed to run agent programs.", { kind: "denied" });
    try {
      return await bridge.call("proc.spawn", params);
    } catch (error) {
      throw refused(error);
    }
  };

  const kill = (/** @type {string} */ procId, /** @type {"term" | "kill"} */ signal) =>
    bridge.call("proc.kill", { procId, signal, scope: scope() }).catch(() => {});

  /**
   * Start a program and hand its output over line by line. `done` resolves with how it ended,
   * also after a stop or a timeout (`timeoutMs` 0 waits as long as it takes).
   * @param {string} command
   * @param {string[]} args
   * @param {StartOptions} options
   * @returns {Promise<Handle>}
   */
  const start = async (command, args, options) => {
    const { procId } = await spawn(command, args, options.cwd);
    const splitters = { stdout: lines(), stderr: lines() };
    /** @type {string[]} */
    const tail = [];
    let ended = false;
    let timedOut = false;
    let stopped = false;
    /** @type {(outcome: Outcome) => void} */
    let resolve = () => {};
    /** @type {Promise<Outcome>} */
    const done = new Promise((r) => {
      resolve = r;
    });
    const timeoutMs = options.timeoutMs ?? 0;
    const timer =
      timeoutMs > 0
        ? timers.setTimeout(() => {
            timedOut = true;
            void kill(procId, "term");
          }, timeoutMs)
        : undefined;
    const emit = (/** @type {Stream} */ which, /** @type {string} */ line) => {
      if (which === "stderr" && tail.push(line) > STDERR_KEPT) tail.shift();
      options.onLine(which, line);
    };
    const feed = (/** @type {BridgeEvent} */ event) => {
      if (event.event === "proc.output") {
        const which = event.data.stream === "stderr" ? "stderr" : "stdout";
        for (const line of splitters[which].push(event.data.data, event.data.encoding))
          emit(which, line);
      } else if (event.event === "proc.exit" && !ended) {
        ended = true;
        jobs.delete(procId);
        if (timer !== undefined) timers.clearTimeout(timer);
        for (const which of /** @type {const} */ (["stdout", "stderr"])) {
          const rest = splitters[which].end();
          if (rest !== undefined) emit(which, rest);
        }
        resolve({
          code: event.data.code ?? null,
          signal: event.data.signal ?? null,
          stderr: tail.join("\n"),
          timedOut,
          stopped,
        });
      }
    };
    jobs.set(procId, feed);
    for (const event of early.get(procId) ?? []) feed(event);
    early.delete(procId);
    return {
      procId,
      done,
      stop: async () => {
        if (ended) return;
        stopped = true;
        await kill(procId, "term");
      },
    };
  };

  /**
   * Run a short program to its end and resolve with what it wrote.
   * @param {string} command
   * @param {string[]} args
   * @param {{ cwd?: string, timeoutMs?: number }} [options]
   */
  const run = async (command, args, options = {}) => {
    /** @type {string[]} */
    const out = [];
    const handle = await start(command, args, {
      ...options,
      onLine: (which, line) => {
        if (which === "stdout") out.push(line);
      },
    });
    const outcome = await handle.done;
    return { ...outcome, stdout: out.join("\n") };
  };

  return { start, run, running: () => jobs.size };
}

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";
const messageOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "";

/** Splits a stream into lines as it arrives; base64 chunks go through a streaming decoder. */
export function lines() {
  const decoder = new TextDecoder("utf-8");
  let rest = "";
  const cut = (/** @type {string} */ line) =>
    (line.endsWith("\r") ? line.slice(0, -1) : line).slice(0, LINE_LIMIT);
  return {
    /** @param {string} data @param {"utf8" | "base64"} encoding */
    push(data, encoding) {
      rest += encoding === "utf8" ? data : decoder.decode(decode(data), { stream: true });
      const parts = rest.split("\n");
      rest = parts.pop() ?? "";
      if (rest.length > LINE_LIMIT) {
        parts.push(rest);
        rest = "";
      }
      return parts.map(cut);
    },
    /** What is left after the last newline, if anything. */
    end() {
      const last = rest + decoder.decode();
      rest = "";
      return last === "" ? undefined : cut(last);
    },
  };
}

/** @param {string} data base64 */
function decode(data) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
